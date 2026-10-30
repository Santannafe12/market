import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  AUDIT_KEY_VERSION,
  auditHmac,
  auditIdentities,
  canonicalGenesis,
  canonicalState,
  verifyAuction,
} from '../src/audit/audit';
import { MONEY_MAX_CENTS } from '../src/common/money';
import { validateEnv } from '../src/config/env';
import { configureApp } from '../src/configure-app';
import { DUE_SCAN_LIMIT, SettlementService } from '../src/settlement/settlement.service';

const prisma = new PrismaClient();
let app: INestApplication;

describe('settlement', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, validateEnv(process.env));
    await app.init();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Receipt", "Bid", "WalletLedger", "Auction", "Wallet", "User" CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('settles a winner once, publishes a receipt without personal data, and refuses a second close', async () => {
    const seller = await register(Role.SELLER, 'seller.settle@example.com');
    const ana = await register(Role.BIDDER, 'ana.settle@example.com');
    const bruno = await register(Role.BIDDER, 'bruno.settle@example.com');
    await deposit(ana.accessToken, 10_000);
    await deposit(bruno.accessToken, 10_000);
    const window = await liveWindow(2 * 60 * 60_000);
    const auctionId = await insertAuction(seller.user, {
      startingBidCents: 1_000,
      minIncrementCents: 100,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      title: 'Livro arrematado',
    });
    expect((await bid(ana.accessToken, auctionId, 1_000)).status).toBe(201);
    expect((await bid(bruno.accessToken, auctionId, 1_100)).status).toBe(201);
    const before = await wallet(bruno.accessToken);
    expect(before.body).toEqual({ balanceCents: 10_000, committedCents: 1_100, availableCents: 8_900 });
    const head = (await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } })).auditHeadHash;

    const settlement = app.get(SettlementService);
    expect((await settlement.markEnded(auctionId)).outcome).toBe('ENDED');
    expect((await settlement.finalizeAuction(auctionId)).outcome).toBe('SETTLED');
    expect((await settlement.finalizeAuction(auctionId)).outcome).toBe('ALREADY_FINAL');

    const after = await wallet(bruno.accessToken);
    expect(after.body).toEqual({ balanceCents: 8_900, committedCents: 0, availableCents: 8_900 });
    const anaAfter = await wallet(ana.accessToken);
    expect(anaAfter.body).toEqual({ balanceCents: 10_000, committedCents: 0, availableCents: 10_000 });
    const sellerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: seller.user.id } });
    expect(sellerWallet.balanceCents).toBe(1_100);

    const ledger = await prisma.walletLedger.findMany({
      where: { type: { in: ['SETTLEMENT_DEBIT', 'SETTLEMENT_CREDIT'] } },
      orderBy: { type: 'asc' },
    });
    expect(ledger).toHaveLength(2);
    expect(ledger.map((entry) => entry.type).sort()).toEqual(['SETTLEMENT_CREDIT', 'SETTLEMENT_DEBIT']);
    expect(ledger.every((entry) => entry.amountCents === 1_100 && entry.auctionId === auctionId)).toBe(true);
    const debit = ledger.find((entry) => entry.type === 'SETTLEMENT_DEBIT');
    const credit = ledger.find((entry) => entry.type === 'SETTLEMENT_CREDIT');
    expect(debit?.balanceAfterCents).toBe(8_900);
    expect(credit?.balanceAfterCents).toBe(1_100);

    const row = await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } });
    expect(row.status).toBe('SETTLED');
    expect(row.auditHeadHash).toBe(head);
    expect(row.bidCount).toBe(2);
    expect((await verdict(auctionId)).verdict).toBe('INTEGRO');
    expect((await request(server()).get(`/api/auctions/${auctionId}/audit`)).body.verdict).toBe('INTEGRO');

    const winnerParts = await request(server()).get('/api/me/participations').set(auth(bruno.accessToken));
    const loserParts = await request(server()).get('/api/me/participations').set(auth(ana.accessToken));
    expect(winnerParts.body[0].result).toBe('WON');
    expect(loserParts.body[0].result).toBe('LOST');
    expect(loserParts.body[0].receiptToken).toBeNull();
    const token = winnerParts.body[0].receiptToken as string;
    const receipt = await request(server()).get(`/api/receipts/${token}`);
    expect(receipt.status).toBe(200);
    expect(receipt.body.title).toBe('Livro arrematado');
    expect(receipt.body.winnerPublicId).toBe(bruno.user.publicId);
    expect(receipt.body.sellerPublicId).toBe(seller.user.publicId);
    const json = JSON.stringify(receipt.body);
    for (const hidden of [ana.user.email, bruno.user.email, seller.user.email, ana.user.id, bruno.user.id, seller.user.id, 'Ana Licitante']) {
      expect(json).not.toContain(hidden);
    }
    expect(await prisma.receipt.count({ where: { auctionId } })).toBe(1);

    await prisma.walletLedger.create({
      data: {
        id: randomUUID(),
        walletId: sellerWallet.id,
        type: 'DEPOSIT',
        amountCents: 500,
        balanceAfterCents: 1_600,
      },
    });
    const received = await request(server()).get('/api/auctions/received').set(auth(seller.accessToken));
    expect(received.body).toEqual({ receivedCents: 1_100 });

    const cancel = await request(server()).post(`/api/auctions/${auctionId}/cancel`).set(auth(seller.accessToken));
    expect(cancel.status).toBe(422);
    expect(cancel.body.code).toBe('ALREADY_FINAL');
    const late = await bid(ana.accessToken, auctionId, 1_200);
    expect(late.status).toBe(422);
    expect(late.body.code).toBe('AUCTION_ENDED');
    expect(await prisma.bid.count({ where: { auctionId } })).toBe(2);
  });

  it('closes an empty lot as unsold without a receipt or a ledger line', async () => {
    const seller = await register(Role.SELLER, 'seller.unsold@example.com');
    const window = await liveWindow(2 * 60 * 60_000);
    const auctionId = await insertAuction(seller.user, {
      startingBidCents: 1_000,
      minIncrementCents: 100,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      title: 'Sem lances',
    });
    const settlement = app.get(SettlementService);
    expect((await settlement.markEnded(auctionId)).outcome).toBe('ENDED');
    expect((await settlement.finalizeAuction(auctionId)).outcome).toBe('UNSOLD');
    expect((await settlement.finalizeAuction(auctionId)).outcome).toBe('ALREADY_FINAL');

    const row = await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } });
    expect(row.status).toBe('UNSOLD');
    expect(row.currentLeaderId).toBeNull();
    expect(await prisma.receipt.count()).toBe(0);
    expect(await prisma.walletLedger.count({ where: { type: { in: ['SETTLEMENT_DEBIT', 'SETTLEMENT_CREDIT'] } } })).toBe(0);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: seller.user.id } })).balanceCents).toBe(0);
    expect((await verdict(auctionId)).verdict).toBe('INTEGRO');
    const ended = await request(server()).get('/api/auctions?status=ended').set(auth(seller.accessToken));
    expect(ended.body.map((auction: { id: string }) => auction.id)).toContain(auctionId);
  });

  it('lets two finalizations and two scans produce one receipt and one debit per lot', async () => {
    const seller = await register(Role.SELLER, 'seller.once@example.com');
    const ana = await register(Role.BIDDER, 'ana.once@example.com');
    await deposit(ana.accessToken, 50_000);
    const settlement = app.get(SettlementService);

    const single = await dueLot(seller.user, ana.accessToken, 1_000);
    await Promise.all([settlement.finalizeAuction(single), settlement.finalizeAuction(single)]);
    expect(await prisma.receipt.count({ where: { auctionId: single } })).toBe(1);
    expect(await prisma.walletLedger.count({ where: { auctionId: single, type: 'SETTLEMENT_DEBIT' } })).toBe(1);
    expect(await prisma.walletLedger.count({ where: { auctionId: single, type: 'SETTLEMENT_CREDIT' } })).toBe(1);
    expect((await wallet(ana.accessToken)).body.balanceCents).toBe(49_000);

    const lots = await Promise.all([
      dueLot(seller.user, ana.accessToken, 1_000),
      dueLot(seller.user, ana.accessToken, 1_000),
      dueLot(seller.user, ana.accessToken, 1_000),
    ]);
    await Promise.all([settlement.finalizeDueAuctions(), settlement.finalizeDueAuctions()]);
    for (const id of lots) {
      expect(await prisma.receipt.count({ where: { auctionId: id } })).toBe(1);
      expect(await prisma.walletLedger.count({ where: { auctionId: id, type: 'SETTLEMENT_DEBIT' } })).toBe(1);
      expect((await prisma.auction.findUniqueOrThrow({ where: { id } })).status).toBe('SETTLED');
      expect((await verdict(id)).verdict).toBe('INTEGRO');
    }
    expect((await wallet(ana.accessToken)).body).toEqual({
      balanceCents: 46_000,
      committedCents: 0,
      availableCents: 46_000,
    });
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: seller.user.id } })).balanceCents).toBe(4_000);
  }, 60_000);

  it('races a late bid and a cancellation against settlement, and releases a commitment without a credit', async () => {
    const seller = await register(Role.SELLER, 'seller.race@example.com');
    const ana = await register(Role.BIDDER, 'ana.race@example.com');
    const bruno = await register(Role.BIDDER, 'bruno.race@example.com');
    await deposit(ana.accessToken, 20_000);
    await deposit(bruno.accessToken, 20_000);
    const settlement = app.get(SettlementService);

    const soon = await liveWindow(30_000);
    const extendedId = await insertAuction(seller.user, {
      startingBidCents: 1_000,
      minIncrementCents: 100,
      startsAt: soon.startsAt,
      endsAt: soon.endsAt,
      title: 'Prorrogado',
    });
    expect((await bid(ana.accessToken, extendedId, 1_000)).status).toBe(201);
    const extended = await prisma.auction.findUniqueOrThrow({ where: { id: extendedId } });
    expect(extended.endsAt.getTime()).toBe(soon.endsAt.getTime() + 120_000);
    expect((await settlement.finalizeAuction(extendedId)).outcome).toBe('NOT_DUE');
    expect((await prisma.auction.findUniqueOrThrow({ where: { id: extendedId } })).status).toBe('OPEN');
    expect(await prisma.receipt.count({ where: { auctionId: extendedId } })).toBe(0);

    const near = await liveWindow(400);
    const raceId = await insertAuction(seller.user, {
      startingBidCents: 1_000,
      minIncrementCents: 100,
      startsAt: near.startsAt,
      endsAt: near.endsAt,
      title: 'Disputa',
    });
    const [bidResponse, firstClose] = await Promise.all([
      bid(ana.accessToken, raceId, 1_000),
      settlement.finalizeAuction(raceId),
    ]);
    if (bidResponse.status === 201) {
      const row = await prisma.auction.findUniqueOrThrow({ where: { id: raceId } });
      expect(row.status).toBe('OPEN');
      expect(row.endsAt.getTime()).toBeGreaterThanOrEqual(near.endsAt.getTime() + 120_000);
      expect(firstClose.outcome).toBe('NOT_DUE');
      expect(await prisma.receipt.count({ where: { auctionId: raceId } })).toBe(0);
      expect(await prisma.walletLedger.count({ where: { auctionId: raceId, type: 'SETTLEMENT_DEBIT' } })).toBe(0);
      expect((await settlement.finalizeAuction(raceId)).outcome).toBe('NOT_DUE');
    } else {
      expect(bidResponse.status).toBe(422);
      expect(bidResponse.body.code).toBe('AUCTION_ENDED');
      let row = await prisma.auction.findUniqueOrThrow({ where: { id: raceId } });
      if (row.status === 'OPEN') {
        expect(firstClose.outcome).toBe('NOT_DUE');
        expect((await settlement.finalizeAuction(raceId)).outcome).toBe('SETTLED');
        row = await prisma.auction.findUniqueOrThrow({ where: { id: raceId } });
      }
      expect(row.status).toBe('SETTLED');
      expect(await prisma.bid.count({ where: { auctionId: raceId } })).toBe(0);
      expect(await prisma.receipt.count({ where: { auctionId: raceId } })).toBe(1);
      expect(await prisma.walletLedger.count({ where: { auctionId: raceId, type: 'SETTLEMENT_DEBIT' } })).toBe(1);
      expect(await prisma.walletLedger.count({ where: { auctionId: raceId, type: 'SETTLEMENT_CREDIT' } })).toBe(1);
    }

    const releaseId = await dueLot(seller.user, ana.accessToken, 2_000);
    const committed = await wallet(ana.accessToken);
    const released = await request(server()).post(`/api/auctions/${releaseId}/cancel`).set(auth(seller.accessToken));
    expect(released.status).toBe(200);
    expect(released.body.status).toBe('CANCELLED');
    const freed = await wallet(ana.accessToken);
    expect(freed.body.balanceCents).toBe(committed.body.balanceCents);
    expect(freed.body.committedCents).toBe(committed.body.committedCents - 2_000);
    expect(freed.body.availableCents).toBe(committed.body.availableCents + 2_000);
    expect(await prisma.walletLedger.count({ where: { auctionId: releaseId } })).toBe(0);
    expect(await prisma.bid.count({ where: { auctionId: releaseId } })).toBe(1);
    expect((await verdict(releaseId)).verdict).toBe('INTEGRO');
    expect((await request(server()).get(`/api/auctions/${releaseId}/audit`)).body.verdict).toBe('INTEGRO');

    const contestId = await dueLot(seller.user, bruno.accessToken, 1_500);
    const balanceBefore = (await wallet(bruno.accessToken)).body.balanceCents;
    const [cancelResponse, closeResponse] = await Promise.all([
      request(server()).post(`/api/auctions/${contestId}/cancel`).set(auth(seller.accessToken)),
      settlement.finalizeAuction(contestId),
    ]);
    const contest = await prisma.auction.findUniqueOrThrow({ where: { id: contestId } });
    const receipts = await prisma.receipt.count({ where: { auctionId: contestId } });
    const debits = await prisma.walletLedger.count({ where: { auctionId: contestId, type: 'SETTLEMENT_DEBIT' } });
    const credits = await prisma.walletLedger.count({ where: { auctionId: contestId, type: 'SETTLEMENT_CREDIT' } });
    expect(debits).toBe(credits);
    if (contest.status === 'CANCELLED') {
      expect(cancelResponse.status).toBe(200);
      expect(closeResponse.outcome).toBe('ALREADY_FINAL');
      expect(receipts).toBe(0);
      expect(debits).toBe(0);
      expect((await wallet(bruno.accessToken)).body.balanceCents).toBe(balanceBefore);
    } else {
      expect(contest.status).toBe('SETTLED');
      expect(cancelResponse.status).toBe(422);
      expect(cancelResponse.body.code).toBe('ALREADY_FINAL');
      expect(receipts).toBe(1);
      expect(debits).toBe(1);
      expect((await wallet(bruno.accessToken)).body.balanceCents).toBe(balanceBefore - 1_500);
    }
    expect(contest.status === 'CANCELLED' && receipts > 0).toBe(false);
    expect((await verdict(contestId)).verdict).toBe('INTEGRO');
  }, 60_000);

  it('keeps a tampered or overflowing lot open, and the scan recovers a lot that ended while the process was down', async () => {
    const seller = await register(Role.SELLER, 'seller.guard@example.com');
    const other = await register(Role.SELLER, 'other.guard@example.com');
    const ana = await register(Role.BIDDER, 'ana.guard@example.com');
    await deposit(ana.accessToken, 20_000);
    const settlement = app.get(SettlementService);

    const tamperedId = await dueLot(seller.user, ana.accessToken, 1_000);
    const signed = await prisma.auction.findUniqueOrThrow({ where: { id: tamperedId } });
    await prisma.auction.update({
      where: { id: tamperedId },
      data: { sellerId: other.user.id },
    });
    expect((await settlement.finalizeAuction(tamperedId)).outcome).toBe('INTEGRITY');
    const stillOpen = await prisma.auction.findUniqueOrThrow({ where: { id: tamperedId } });
    expect(stillOpen.status).toBe('OPEN');
    expect(stillOpen.auditStateMac).toBe(signed.auditStateMac);
    expect(stillOpen.version).toBe(signed.version);
    expect(await prisma.receipt.count({ where: { auctionId: tamperedId } })).toBe(0);
    expect(await prisma.walletLedger.count({ where: { auctionId: tamperedId } })).toBe(0);
    expect((await wallet(ana.accessToken)).body.balanceCents).toBe(20_000);
    expect((await request(server()).get(`/api/auctions/${tamperedId}/audit`)).body.verdict).toBe('ADULTERADO');

    const endsBefore = stillOpen.endsAt;
    expect((await settlement.markEnded(tamperedId)).outcome).toBe('INTEGRITY');
    const untouched = await prisma.auction.findUniqueOrThrow({ where: { id: tamperedId } });
    expect(untouched.endsAt.getTime()).toBe(endsBefore.getTime());
    expect(untouched.auditStateMac).toBe(signed.auditStateMac);

    const cancel = await request(server()).post(`/api/auctions/${tamperedId}/cancel`).set(auth(other.accessToken));
    expect(cancel.status).toBe(422);
    expect(cancel.body.code).toBe('AUCTION_INTEGRITY');
    expect((await prisma.auction.findUniqueOrThrow({ where: { id: tamperedId } })).auditStateMac).toBe(signed.auditStateMac);

    const overflowId = await dueLot(seller.user, ana.accessToken, 100);
    await prisma.wallet.update({
      where: { userId: seller.user.id },
      data: { balanceCents: MONEY_MAX_CENTS - 50 },
    });
    const sellerBefore = MONEY_MAX_CENTS - 50;
    const winnerBefore = (await wallet(ana.accessToken)).body.balanceCents;
    const macBefore = (await prisma.auction.findUniqueOrThrow({ where: { id: overflowId } })).auditStateMac;
    await expect(settlement.finalizeAuction(overflowId)).rejects.toMatchObject({ code: 'AMOUNT_OVERFLOW' });
    const overflow = await prisma.auction.findUniqueOrThrow({ where: { id: overflowId } });
    expect(overflow.status).toBe('OPEN');
    expect(overflow.auditStateMac).toBe(macBefore);
    expect(await prisma.receipt.count({ where: { auctionId: overflowId } })).toBe(0);
    expect(await prisma.walletLedger.count({ where: { auctionId: overflowId } })).toBe(0);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: seller.user.id } })).balanceCents).toBe(sellerBefore);
    expect((await wallet(ana.accessToken)).body.balanceCents).toBe(winnerBefore);
    await prisma.wallet.update({
      where: { userId: seller.user.id },
      data: { balanceCents: 0 },
    });

    const pendingId = await dueLot(seller.user, ana.accessToken, 1_000);
    expect((await prisma.auction.findUniqueOrThrow({ where: { id: pendingId } })).status).toBe('OPEN');
    await settlement.finalizeDueAuctions();
    expect((await prisma.auction.findUniqueOrThrow({ where: { id: pendingId } })).status).toBe('SETTLED');
    expect(await prisma.receipt.count({ where: { auctionId: pendingId } })).toBe(1);
    expect((await verdict(pendingId)).verdict).toBe('INTEGRO');
  });

  it('settles a later lot when the oldest due page stays open', async () => {
    const seller = await register(Role.SELLER, 'seller.page@example.com');
    const other = await register(Role.SELLER, 'other.page@example.com');
    const ana = await register(Role.BIDDER, 'ana.page@example.com');
    await deposit(ana.accessToken, 5_000);
    const settlement = app.get(SettlementService);
    const now = await dbNow();
    const stuckIds: string[] = [];
    for (let index = 0; index < DUE_SCAN_LIMIT; index += 1) {
      const id = await insertAuction(seller.user, {
        startingBidCents: 1_000,
        minIncrementCents: 100,
        startsAt: new Date(now.getTime() - 180_000),
        endsAt: new Date(now.getTime() - 120_000 + index),
        title: 'Lote preso',
      });
      await prisma.auction.update({ where: { id }, data: { sellerId: other.user.id } });
      stuckIds.push(id);
    }
    const healthyId = await dueLot(seller.user, ana.accessToken, 1_000);

    const first = await settlement.finalizeDueAuctions();
    expect(first).toHaveLength(DUE_SCAN_LIMIT);
    expect(first.every((item) => item.outcome === 'INTEGRITY')).toBe(true);
    expect((await prisma.auction.findUniqueOrThrow({ where: { id: healthyId } })).status).toBe('OPEN');

    const second = await settlement.finalizeDueAuctions();
    expect(second).toEqual([{ outcome: 'SETTLED' }]);
    expect((await prisma.auction.findUniqueOrThrow({ where: { id: healthyId } })).status).toBe('SETTLED');
    expect(await prisma.receipt.count({ where: { auctionId: healthyId } })).toBe(1);
    const stillOpen = await prisma.auction.count({ where: { id: { in: stuckIds }, status: 'OPEN' } });
    expect(stillOpen).toBe(DUE_SCAN_LIMIT);
    expect(await prisma.walletLedger.count({ where: { auctionId: { in: stuckIds } } })).toBe(0);
  }, 60_000);
});

async function dueLot(
  seller: { id: string; publicId: string },
  token: string,
  amountCents: number,
) {
  const window = await liveWindow(2 * 60 * 60_000);
  const id = await insertAuction(seller, {
    startingBidCents: amountCents,
    minIncrementCents: 100,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    title: 'Lote vencido',
  });
  expect((await bid(token, id, amountCents)).status).toBe(201);
  expect((await app.get(SettlementService).markEnded(id)).outcome).toBe('ENDED');
  return id;
}

async function register(role: Role, email: string) {
  const response = await request(server()).post('/api/auth/register').send({
    name: role === Role.SELLER ? 'Helena Vendedora' : 'Ana Licitante',
    email,
    password: 'senha-segura',
    role,
  });
  expect(response.status).toBe(201);
  return response.body as {
    accessToken: string;
    user: { id: string; publicId: string; email: string; name: string };
  };
}

function deposit(token: string, amountCents: number) {
  return request(server()).post('/api/wallet/deposits').set(auth(token)).send({ amountCents });
}

function wallet(token: string) {
  return request(server()).get('/api/wallet').set(auth(token));
}

function bid(token: string, auctionId: string, amountCents: number) {
  return request(server()).post(`/api/auctions/${auctionId}/bids`).set(auth(token)).send({ amountCents });
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
    now,
    startsAt: new Date(now.getTime() - 60_000),
    endsAt: new Date(now.getTime() + msFromNow),
  };
}

async function insertAuction(
  seller: { id: string; publicId: string },
  input: { startingBidCents: number; minIncrementCents: number; startsAt: Date; endsAt: Date; title: string },
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
      startingBidCents: input.startingBidCents,
      minIncrementCents: input.minIncrementCents,
      bidCount: 0,
      version: 0,
      startsAt: input.startsAt,
      originalEndsAt: input.endsAt,
      endsAt: input.endsAt,
      editionId: 'OL1M',
      workId: 'OL1W',
      title: input.title,
      authors: ['Autora'],
      auditHeadHash,
      auditStateMac,
      auditKeyVersion: AUDIT_KEY_VERSION,
    },
  });
  return id;
}

async function verdict(id: string) {
  const row = await prisma.auction.findUniqueOrThrow({ where: { id } });
  const bids = await prisma.bid.findMany({ where: { auctionId: id } });
  const referenced = new Set<string>([row.sellerId, ...bids.map((bid) => bid.bidderId)]);
  if (row.currentLeaderId) {
    referenced.add(row.currentLeaderId);
  }
  const users = await prisma.user.findMany({
    where: { id: { in: [...referenced] } },
    select: { id: true, publicId: true },
  });
  return {
    verdict: verifyAuction(
      row,
      new Map([[AUDIT_KEY_VERSION, secret()]]),
      bids,
      auditIdentities(row.sellerId, users),
    ),
  };
}
