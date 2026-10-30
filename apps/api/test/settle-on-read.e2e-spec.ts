import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AUDIT_KEY_VERSION, auditHmac, canonicalGenesis, canonicalState } from '../src/audit/audit';
import { validateEnv } from '../src/config/env';
import { configureApp } from '../src/configure-app';
import { SettlementService } from '../src/settlement/settlement.service';

const prisma = new PrismaClient();
let app: INestApplication;

describe('settle on read (Vercel mode)', () => {
  beforeAll(async () => {
    process.env.VERCEL = '1';
    delete process.env.SETTLE_ON_READ;
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
    delete process.env.VERCEL;
    process.env.SETTLE_ON_READ = 'false';
  });

  it('registers no interval when running as a Function', () => {
    expect(app.get(SchedulerRegistry).doesExist('interval', 'settlement')).toBe(false);
  });

  it('settles a due lot on its detail read, once, and leaves a running lot open', async () => {
    const seller = await register(Role.SELLER, 'seller.read@example.com');
    const ana = await register(Role.BIDDER, 'ana.read@example.com');
    await deposit(ana.accessToken, 10_000);
    const dueId = await dueLot(seller.user, ana.accessToken, 1_500);
    const runningId = await liveLot(seller.user);

    const [first, second, audit, bids] = await Promise.all([
      request(server()).get(`/api/auctions/${dueId}`),
      request(server()).get(`/api/auctions/${dueId}`),
      request(server()).get(`/api/auctions/${dueId}/audit`),
      request(server()).get(`/api/auctions/${dueId}/bids`),
    ]);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('SETTLED');
    expect(second.body.status).toBe('SETTLED');
    expect(audit.body.verdict).toBe('INTEGRO');
    expect(audit.body.auction.status).toBe('SETTLED');
    expect(bids.status).toBe(200);
    expect(await prisma.receipt.count({ where: { auctionId: dueId } })).toBe(1);
    expect(await prisma.walletLedger.count({ where: { auctionId: dueId, type: 'SETTLEMENT_DEBIT' } })).toBe(1);
    expect(await prisma.walletLedger.count({ where: { auctionId: dueId, type: 'SETTLEMENT_CREDIT' } })).toBe(1);

    const running = await request(server()).get(`/api/auctions/${runningId}`);
    expect(running.body.status).toBe('OPEN');
  });

  it('settles due lots before wallet and list reads, with one debit under concurrent reads', async () => {
    const seller = await register(Role.SELLER, 'seller.scan@example.com');
    const ana = await register(Role.BIDDER, 'ana.scan@example.com');
    await deposit(ana.accessToken, 10_000);
    const lots = [
      await dueLot(seller.user, ana.accessToken, 1_000),
      await dueLot(seller.user, ana.accessToken, 2_000),
    ];

    const reads = await Promise.all([
      request(server()).get('/api/wallet').set(auth(ana.accessToken)),
      request(server()).get('/api/wallet').set(auth(ana.accessToken)),
      request(server()).get('/api/auctions?status=ended').set(auth(seller.accessToken)),
      request(server()).get('/api/me/participations').set(auth(ana.accessToken)),
      request(server()).get('/api/auctions/received').set(auth(seller.accessToken)),
    ]);
    expect(reads.every((response) => response.status === 200)).toBe(true);

    for (const id of lots) {
      expect((await prisma.auction.findUniqueOrThrow({ where: { id } })).status).toBe('SETTLED');
      expect(await prisma.receipt.count({ where: { auctionId: id } })).toBe(1);
      expect(await prisma.walletLedger.count({ where: { auctionId: id, type: 'SETTLEMENT_DEBIT' } })).toBe(1);
    }
    const walletAfter = await request(server()).get('/api/wallet').set(auth(ana.accessToken));
    expect(walletAfter.body).toEqual({ balanceCents: 7_000, committedCents: 0, availableCents: 7_000 });
    const received = await request(server()).get('/api/auctions/received').set(auth(seller.accessToken));
    expect(received.body).toEqual({ receivedCents: 3_000 });
  }, 60_000);

  it('keeps a tampered due lot open and still answers the read', async () => {
    const seller = await register(Role.SELLER, 'seller.tamper@example.com');
    const other = await register(Role.SELLER, 'other.tamper@example.com');
    const ana = await register(Role.BIDDER, 'ana.tamper@example.com');
    await deposit(ana.accessToken, 10_000);
    const id = await dueLot(seller.user, ana.accessToken, 1_000);
    await prisma.auction.update({ where: { id }, data: { sellerId: other.user.id } });

    const detail = await request(server()).get(`/api/auctions/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('OPEN');
    const wallet = await request(server()).get('/api/wallet').set(auth(ana.accessToken));
    expect(wallet.status).toBe(200);
    expect(wallet.body.balanceCents).toBe(10_000);
    expect(await prisma.receipt.count({ where: { auctionId: id } })).toBe(0);
  });
});

async function dueLot(seller: { id: string; publicId: string }, token: string, amountCents: number) {
  const id = await liveLot(seller, amountCents);
  const placed = await request(server())
    .post(`/api/auctions/${id}/bids`)
    .set(auth(token))
    .send({ amountCents });
  expect(placed.status).toBe(201);
  expect((await app.get(SettlementService).markEnded(id)).outcome).toBe('ENDED');
  return id;
}

async function liveLot(seller: { id: string; publicId: string }, startingBidCents = 1_000) {
  const now = await dbNow();
  const startsAt = new Date(now.getTime() - 60_000);
  const endsAt = new Date(now.getTime() + 2 * 60 * 60_000);
  const id = randomUUID();
  const secret = process.env.AUDIT_HMAC_SECRET ?? '';
  const auditHeadHash = auditHmac(secret, canonicalGenesis(id));
  const auditStateMac = auditHmac(
    secret,
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
      startsAt,
      originalEndsAt: endsAt,
      endsAt,
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
      startingBidCents,
      minIncrementCents: 100,
      bidCount: 0,
      version: 0,
      startsAt,
      originalEndsAt: endsAt,
      endsAt,
      editionId: 'OL1M',
      workId: 'OL1W',
      title: 'Lote lido',
      authors: ['Autora'],
      auditHeadHash,
      auditStateMac,
      auditKeyVersion: AUDIT_KEY_VERSION,
    },
  });
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
  return response.body as { accessToken: string; user: { id: string; publicId: string } };
}

function deposit(token: string, amountCents: number) {
  return request(server()).post('/api/wallet/deposits').set(auth(token)).send({ amountCents });
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function server() {
  return app.getHttpServer();
}

async function dbNow() {
  const rows = await prisma.$queryRaw<Array<{ now: Date }>>`
    SELECT date_trunc('milliseconds', clock_timestamp()) AS "now"
  `;
  return new Date(rows[0]?.now);
}
