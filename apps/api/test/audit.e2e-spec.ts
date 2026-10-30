import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuctionsModule } from '../src/auctions/auctions.module';
import { AuctionsService } from '../src/auctions/auctions.service';
import { AUDIT_KEY_VERSION, auditHmac, canonicalGenesis, canonicalState } from '../src/audit/audit';
import { validateEnv } from '../src/config/env';
import { configureApp } from '../src/configure-app';

const prisma = new PrismaClient();
let app: INestApplication;

describe('public audit', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, validateEnv(process.env));
    await app.init();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Bid", "WalletLedger", "Auction", "Wallet", "User" CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('publishes an intact empty lot, a cancelled lot, and a legitimate chain without personal data', async () => {
    const seller = await register(Role.SELLER, 'Helena Auditora', 'helena.auditoria@example.com');
    const ana = await register(Role.BIDDER, 'Ana Marcadora', 'ana.marcador@example.com');
    const bruno = await register(Role.BIDDER, 'Bruno Marcador', 'bruno.marcador@example.com');
    const window = await liveWindow(2 * 60 * 60_000);
    const emptyId = await insertAuction(seller.user, window);
    const missing = await audit(randomUUID());
    expect(missing.status).toBe(404);

    const empty = await audit(emptyId);
    expect(empty.status).toBe(200);
    expect(empty.body.verdict).toBe('INTEGRO');
    expect(empty.body.failures).toEqual([]);
    expect(empty.body.bids).toEqual([]);

    const cancelled = await request(server())
      .post(`/api/auctions/${emptyId}/cancel`)
      .set(auth(seller.accessToken));
    expect(cancelled.status).toBe(200);
    const cancelledAudit = await audit(emptyId);
    expect(cancelledAudit.body.verdict).toBe('INTEGRO');
    expect(cancelledAudit.body.auction.status).toBe('CANCELLED');

    await deposit(ana.accessToken, 20_000);
    await deposit(bruno.accessToken, 20_000);
    const auctionId = await insertAuction(seller.user, window);
    expect((await bid(ana.accessToken, auctionId, 1_000)).status).toBe(201);
    expect((await bid(bruno.accessToken, auctionId, 1_100)).status).toBe(201);
    const intact = await audit(auctionId);
    expect(intact.body.verdict).toBe('INTEGRO');
    expect(intact.body.failures).toEqual([]);
    expect(intact.body.bids.map((item: { sequence: number }) => item.sequence)).toEqual([1, 2]);
    expect(intact.body.bids[1]).toMatchObject({
      bidderPublicId: bruno.user.publicId,
      amountCents: 1_100,
    });
    expect(typeof intact.body.bids[1].hash).toBe('string');
    const json = JSON.stringify(intact.body);
    for (const hidden of [
      ana.user.id,
      bruno.user.id,
      seller.user.id,
      ana.user.email,
      bruno.user.email,
      seller.user.email,
      'Ana Marcadora',
      'Bruno Marcador',
      'Helena Auditora',
      'bidderId',
      'sellerId',
      'currentLeaderId',
      'password',
    ]) {
      expect(json).not.toContain(hidden);
    }
    expect(json).toContain(ana.user.publicId);
    expect(json).toContain(seller.user.publicId);

    const row = await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } });
    await prisma.auction.update({
      where: { id: auctionId },
      data: {
        status: 'CANCELLED',
        auditStateMac: auditHmac(secret(), canonicalState(stateOf({ ...row, status: 'CANCELLED' }))),
      },
    });
    const cancelledChain = await audit(auctionId);
    expect(cancelledChain.body.verdict).toBe('INTEGRO');
    expect(cancelledChain.body.bids).toHaveLength(2);
  });

  it('detects a changed amount, a removed bid, and an inserted bid', async () => {
    const seller = await register(Role.SELLER, 'Helena Auditora', 'helena.cadeia@example.com');
    const ana = await register(Role.BIDDER, 'Ana Marcadora', 'ana.cadeia@example.com');
    const bruno = await register(Role.BIDDER, 'Bruno Marcador', 'bruno.cadeia@example.com');
    const lot = await chain(seller, [ana, bruno, ana]);
    const saved = await snapshot(lot);

    await prisma.$executeRaw`
      UPDATE "Bid" SET "amountCents" = "amountCents" + 1
      WHERE "auctionId" = CAST(${lot} AS uuid) AND "sequence" = 2
    `;
    await expectCodes(lot, ['BID_HMAC'], [ana.user.id, bruno.user.id]);
    await restore(saved);

    await prisma.bid.delete({ where: { auctionId_sequence: { auctionId: lot, sequence: 2 } } });
    await expectCodes(lot, ['SEQUENCE', 'BID_COUNT', 'PREVIOUS_HASH'], [ana.user.id, bruno.user.id]);
    await restore(saved);

    await prisma.bid.delete({ where: { auctionId_sequence: { auctionId: lot, sequence: 3 } } });
    await expectCodes(lot, ['BID_COUNT', 'HEAD'], [ana.user.id, bruno.user.id]);
    await restore(saved);

    await prisma.bid.create({
      data: {
        id: randomUUID(),
        auctionId: lot,
        sequence: 4,
        bidderId: ana.user.id,
        bidderPublicId: ana.user.publicId,
        amountCents: 100,
        previousHash: 'ab'.repeat(32),
        hash: 'cd'.repeat(32),
        endsAtAfter: new Date(),
        createdAt: new Date(),
      },
    });
    await expectCodes(lot, ['BID_COUNT', 'BID_HMAC', 'PREVIOUS_HASH'], [ana.user.id]);
  });

  it('detects a changed price, bidder, leader, seller, or public id, and an unknown key', async () => {
    const seller = await register(Role.SELLER, 'Helena Auditora', 'helena.vinculo@example.com');
    const other = await register(Role.SELLER, 'Marina Auditora', 'marina.vinculo@example.com');
    const ana = await register(Role.BIDDER, 'Ana Marcadora', 'ana.vinculo@example.com');
    const bruno = await register(Role.BIDDER, 'Bruno Marcador', 'bruno.vinculo@example.com');
    const lot = await chain(seller, [ana, bruno]);
    const saved = await snapshot(lot);
    const hidden = [ana.user.id, bruno.user.id, seller.user.id, other.user.id];

    await prisma.$executeRaw`
      UPDATE "Auction" SET "currentBidCents" = "currentBidCents" + 1
      WHERE id = CAST(${lot} AS uuid)
    `;
    await expectCodes(lot, ['CURRENT_BID', 'STATE_MAC'], hidden);
    await restore(saved);

    await prisma.$executeRaw`
      UPDATE "Bid" SET "bidderId" = CAST(${bruno.user.id} AS uuid)
      WHERE "auctionId" = CAST(${lot} AS uuid) AND "sequence" = 1
    `;
    await expectCodes(lot, ['BID_HMAC', 'BIDDER_LINK'], hidden);
    await restore(saved);

    await prisma.$executeRaw`
      UPDATE "Auction" SET "currentLeaderId" = CAST(${ana.user.id} AS uuid)
      WHERE id = CAST(${lot} AS uuid)
    `;
    await expectCodes(lot, ['LEADER', 'STATE_MAC'], hidden);
    await restore(saved);

    await prisma.$executeRaw`
      UPDATE "Auction" SET "sellerId" = CAST(${other.user.id} AS uuid)
      WHERE id = CAST(${lot} AS uuid)
    `;
    await expectCodes(lot, ['SELLER_LINK', 'STATE_MAC'], hidden);
    await restore(saved);

    await prisma.user.update({ where: { id: bruno.user.id }, data: { publicId: 'TROCADO01' } });
    const relinked = await expectCodes(lot, ['BIDDER_LINK', 'LEADER_LINK'], hidden);
    expect(relinked.body.failures.map((item: { code: string }) => item.code)).not.toContain('BID_HMAC');
    await prisma.user.update({ where: { id: bruno.user.id }, data: { publicId: bruno.user.publicId } });
    await restore(saved);

    await prisma.auction.update({ where: { id: lot }, data: { auditKeyVersion: 99 } });
    const unknown = await audit(lot);
    expect(unknown.status).toBe(200);
    expect(unknown.body.verdict).toBe('INDETERMINADO');
    expect(unknown.body.failures).toEqual([
      expect.objectContaining({ code: 'KEY_UNKNOWN' }),
    ]);
    expect(JSON.stringify(unknown.body)).not.toContain(secret());
    for (const id of hidden) {
      expect(JSON.stringify(unknown.body)).not.toContain(id);
    }
  });

  it('returns to intact when a previously valid snapshot is restored', async () => {
    const seller = await register(Role.SELLER, 'Helena Auditora', 'helena.rollback@example.com');
    const ana = await register(Role.BIDDER, 'Ana Marcadora', 'ana.rollback@example.com');
    const lot = await chain(seller, [ana]);
    const saved = await snapshot(lot);

    await prisma.$executeRaw`
      UPDATE "Bid" SET "amountCents" = "amountCents" + 1
      WHERE "auctionId" = CAST(${lot} AS uuid)
    `;
    expect((await audit(lot)).body.verdict).toBe('ADULTERADO');

    // Limite conhecido: lances e âncora que já eram válidos juntos voltam a INTEGRO.
    // Isso não é falha da verificação. Um rollback completo de snapshot não é detectável
    // sem ancoragem externa, e o plano 08 explica essa limitação.
    await restore(saved);
    const restored = await audit(lot);
    expect(restored.body.verdict).toBe('INTEGRO');
    expect(restored.body.failures).toEqual([]);
  });

  it('stays intact when a bid commits while the audit snapshot is open', async () => {
    const seller = await register(Role.SELLER, 'Helena Auditora', 'helena.snapshot@example.com');
    const ana = await register(Role.BIDDER, 'Ana Marcadora', 'ana.snapshot@example.com');
    await deposit(ana.accessToken, 5_000);
    const auctionId = await insertAuction(seller.user, await liveWindow(2 * 60 * 60_000));
    const auctions = app.select(AuctionsModule).get(AuctionsService);
    auctions.auditSnapshotGap = async () => {
      expect((await bid(ana.accessToken, auctionId, 1_000)).status).toBe(201);
    };
    try {
      const during = await audit(auctionId);
      expect(during.status).toBe(200);
      expect(during.body.verdict).toBe('INTEGRO');
      expect(during.body.failures).toEqual([]);
      expect(during.body.bids).toEqual([]);
      expect(during.body.auction.bidCount).toBe(0);
      expect(await prisma.bid.count({ where: { auctionId } })).toBe(1);
    } finally {
      auctions.auditSnapshotGap = null;
    }
    const after = await audit(auctionId);
    expect(after.body.verdict).toBe('INTEGRO');
    expect(after.body.bids).toHaveLength(1);
    expect(after.body.bids[0]).toMatchObject({
      bidderPublicId: ana.user.publicId,
      amountCents: 1_000,
    });
    expect(JSON.stringify(after.body)).not.toContain(ana.user.id);
    expect(JSON.stringify(after.body)).not.toContain(ana.user.email);
  });
});

async function chain(
  seller: { accessToken: string; user: Person },
  bidders: Array<{ accessToken: string; user: Person }>,
) {
  for (const bidder of bidders) {
    expect((await deposit(bidder.accessToken, 20_000)).status).toBe(201);
  }
  const window = await liveWindow(2 * 60 * 60_000);
  const auctionId = await insertAuction(seller.user, window);
  let amount = 1_000;
  const seen = new Set<string>();
  for (const bidder of bidders) {
    if (seen.has(bidder.user.id)) {
      amount += 200;
    }
    seen.add(bidder.user.id);
    expect((await bid(bidder.accessToken, auctionId, amount)).status).toBe(201);
    amount += 100;
  }
  return auctionId;
}

async function expectCodes(auctionId: string, codes: string[], hidden: string[]) {
  const response = await audit(auctionId);
  expect(response.status).toBe(200);
  expect(response.body.verdict).toBe('ADULTERADO');
  const found = response.body.failures.map((item: { code: string }) => item.code);
  for (const code of codes) {
    expect(found).toContain(code);
  }
  const json = JSON.stringify(response.body);
  for (const value of hidden) {
    expect(json).not.toContain(value);
  }
  return response;
}

async function snapshot(auctionId: string) {
  const auction = await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } });
  const bids = await prisma.bid.findMany({ where: { auctionId }, orderBy: { sequence: 'asc' } });
  return { auction, bids };
}

async function restore(saved: Awaited<ReturnType<typeof snapshot>>) {
  await prisma.bid.deleteMany({ where: { auctionId: saved.auction.id } });
  if (saved.bids.length > 0) {
    await prisma.bid.createMany({ data: saved.bids });
  }
  const { auction } = saved;
  await prisma.auction.update({
    where: { id: auction.id },
    data: {
      sellerId: auction.sellerId,
      sellerPublicId: auction.sellerPublicId,
      status: auction.status,
      currentBidCents: auction.currentBidCents,
      currentLeaderId: auction.currentLeaderId,
      currentLeaderPublicId: auction.currentLeaderPublicId,
      bidCount: auction.bidCount,
      version: auction.version,
      endsAt: auction.endsAt,
      auditHeadHash: auction.auditHeadHash,
      auditStateMac: auction.auditStateMac,
      auditKeyVersion: auction.auditKeyVersion,
    },
  });
}

function stateOf(row: Awaited<ReturnType<typeof snapshot>>['auction']) {
  return {
    version: row.version,
    auctionId: row.id,
    status: row.status,
    sellerId: row.sellerId,
    sellerPublicId: row.sellerPublicId,
    bidCount: row.bidCount,
    currentBidCents: row.currentBidCents,
    currentLeaderId: row.currentLeaderId,
    currentLeaderPublicId: row.currentLeaderPublicId,
    startsAt: row.startsAt,
    originalEndsAt: row.originalEndsAt,
    endsAt: row.endsAt,
    auditHeadHash: row.auditHeadHash,
    keyVersion: row.auditKeyVersion,
  };
}

type Person = { id: string; publicId: string; email: string; name: string };

async function register(role: Role, name: string, email: string) {
  const response = await request(server()).post('/api/auth/register').send({
    name,
    email,
    password: 'senha-segura',
    role,
  });
  expect(response.status).toBe(201);
  return response.body as { accessToken: string; user: Person };
}

function deposit(token: string, amountCents: number) {
  return request(server()).post('/api/wallet/deposits').set(auth(token)).send({ amountCents });
}

function bid(token: string, auctionId: string, amountCents: number) {
  return request(server()).post(`/api/auctions/${auctionId}/bids`).set(auth(token)).send({ amountCents });
}

function audit(auctionId: string) {
  return request(server()).get(`/api/auctions/${auctionId}/audit`);
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function server() {
  return app.getHttpServer();
}

function secret() {
  const value = process.env.AUDIT_HMAC_SECRET;
  if (!value) {
    throw new Error('AUDIT_HMAC_SECRET is missing');
  }
  return value;
}

async function dbNow() {
  const rows = await prisma.$queryRaw<Array<{ now: Date }>>`
    SELECT date_trunc('milliseconds', clock_timestamp()) AS "now"
  `;
  return new Date(rows[0]?.now);
}

async function liveWindow(msFromNow: number) {
  const now = await dbNow();
  return {
    startsAt: new Date(now.getTime() - 60_000),
    endsAt: new Date(now.getTime() + msFromNow),
  };
}

async function insertAuction(
  seller: { id: string; publicId: string },
  input: { startsAt: Date; endsAt: Date },
) {
  const id = randomUUID();
  const auditHeadHash = auditHmac(secret(), canonicalGenesis(id));
  const auditStateMac = auditHmac(
    secret(),
    canonicalState({
      version: 0,
      auctionId: id,
      status: 'OPEN',
      sellerId: seller.id,
      sellerPublicId: seller.publicId,
      bidCount: 0,
      currentBidCents: null,
      currentLeaderId: null,
      currentLeaderPublicId: null,
      startsAt: input.startsAt,
      originalEndsAt: input.endsAt,
      endsAt: input.endsAt,
      auditHeadHash,
      keyVersion: AUDIT_KEY_VERSION,
    }),
  );
  await prisma.auction.create({
    data: {
      id,
      sellerId: seller.id,
      sellerPublicId: seller.publicId,
      status: 'OPEN',
      startingBidCents: 1_000,
      minIncrementCents: 100,
      bidCount: 0,
      version: 0,
      startsAt: input.startsAt,
      originalEndsAt: input.endsAt,
      endsAt: input.endsAt,
      editionId: 'OL1M',
      workId: 'OL1W',
      title: 'Lote auditado',
      authors: ['Autora'],
      auditHeadHash,
      auditStateMac,
      auditKeyVersion: AUDIT_KEY_VERSION,
    },
  });
  return id;
}
