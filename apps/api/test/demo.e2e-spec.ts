import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuctionsService } from '../src/auctions/auctions.service';
import { BiddingService } from '../src/bidding/bidding.service';
import { validateEnv } from '../src/config/env';
import { configureApp } from '../src/configure-app';
import {
  DEMO_DEPOSIT_CENTS,
  DEMO_PASSWORD,
  DEMO_RECEIPT_TOKEN,
  DEMO_USERS,
  DemoSeed,
  type DemoTag,
} from '../src/demo/demo-seed';
import { SettlementService } from '../src/settlement/settlement.service';

const prisma = new PrismaClient();
let app: INestApplication;
let seed: DemoSeed;

describe('demo seed', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, validateEnv(process.env));
    await app.init();
    seed = app.get(DemoSeed);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Receipt", "Bid", "WalletLedger", "Auction", "Wallet", "User" CASCADE',
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('runs twice with the live lot open and adds no deposit, bid, receipt or credit', async () => {
    const first = await seed.run();
    expect(first.problems).toEqual([]);
    expect([...first.created].sort()).toEqual(['demo-live', 'demo-scheduled', 'demo-settled', 'demo-unsold']);
    expect(first.deposits.sort()).toEqual([DEMO_USERS.ana.email, DEMO_USERS.bruno.email]);
    const before = await counts();

    const second = await seed.run();
    expect(second).toEqual({ skipped: false, created: [], deposits: [], problems: [] });
    expect(await counts()).toEqual(before);
    expect(before).toEqual({ auctions: 4, bids: 4, deposits: 2, debits: 1, credits: 1, receipts: 1, users: 3 });

    const users = await prisma.user.findMany({ orderBy: { email: 'asc' }, select: { email: true, publicId: true } });
    expect(users).toEqual([
      { email: DEMO_USERS.ana.email, publicId: DEMO_USERS.ana.publicId },
      { email: DEMO_USERS.bruno.email, publicId: DEMO_USERS.bruno.publicId },
      { email: DEMO_USERS.seller.email, publicId: DEMO_USERS.seller.publicId },
    ]);

    const live = await tagged('demo-live');
    expect(live).toHaveLength(1);
    expect(live[0].status).toBe('OPEN');
    expect(live[0].currentLeaderPublicId).toBe(DEMO_USERS.ana.publicId);
    const liveBids = await prisma.bid.findMany({ where: { auctionId: live[0].id }, orderBy: { sequence: 'asc' } });
    expect(liveBids.map((bid) => [bid.bidderPublicId, bid.amountCents])).toEqual([
      [DEMO_USERS.bruno.publicId, 1_000],
      [DEMO_USERS.ana.publicId, 1_500],
    ]);
    expect((await tagged('demo-scheduled'))[0].bidCount).toBe(0);
    expect((await tagged('demo-unsold'))[0].status).toBe('UNSOLD');
    const settled = (await tagged('demo-settled'))[0];
    expect(settled.status).toBe('SETTLED');

    const receipt = await request(server()).get(`/api/receipts/${DEMO_RECEIPT_TOKEN}`);
    expect(receipt.status).toBe(200);
    expect(receipt.body.auctionId).toBe(settled.id);
    expect(receipt.body.winnerPublicId).toBe(DEMO_USERS.bruno.publicId);
    expect(receipt.body.amountCents).toBe(2_500);

    const ana = await login(DEMO_USERS.ana.email);
    expect((await request(server()).get('/api/wallet').set(auth(ana))).body).toEqual({
      balanceCents: DEMO_DEPOSIT_CENTS,
      committedCents: 1_500,
      availableCents: DEMO_DEPOSIT_CENTS - 1_500,
    });
    const bruno = await login(DEMO_USERS.bruno.email);
    expect((await request(server()).get('/api/wallet').set(auth(bruno))).body).toEqual({
      balanceCents: DEMO_DEPOSIT_CENTS - 2_500,
      committedCents: 0,
      availableCents: DEMO_DEPOSIT_CENTS - 2_500,
    });
    const seller = await login(DEMO_USERS.seller.email);
    expect((await request(server()).get('/api/auctions/received').set(auth(seller))).body).toEqual({
      receivedCents: 2_500,
    });

    for (const lot of await prisma.auction.findMany()) {
      expect((await request(server()).get(`/api/auctions/${lot.id}/audit`)).body.verdict).toBe('INTEGRO');
    }
  });

  it('leaves a live demo with an outside bid untouched and renews it only after it ends', async () => {
    await seed.run();
    const [old] = await tagged('demo-live');
    const carla = await register('carla@example.com');
    await request(server()).post('/api/wallet/deposits').set(auth(carla)).send({ amountCents: 10_000 });
    expect((await bid(carla, old.id, 2_000)).status).toBe(201);
    const afterOutsideBid = await prisma.auction.findUniqueOrThrow({ where: { id: old.id } });
    const oldHashes = await hashes(old.id);

    expect((await seed.run()).created).toEqual([]);
    const untouched = await prisma.auction.findUniqueOrThrow({ where: { id: old.id } });
    expect(pick(untouched)).toEqual(pick(afterOutsideBid));
    expect(await hashes(old.id)).toEqual(oldHashes);

    const settlement = app.get(SettlementService);
    expect((await settlement.markEnded(old.id)).outcome).toBe('ENDED');
    const ended = await prisma.auction.findUniqueOrThrow({ where: { id: old.id } });
    const renewed = await seed.run();
    expect(renewed.created).toEqual(['demo-live']);
    expect(renewed.deposits).toEqual([]);

    expect(pick(await prisma.auction.findUniqueOrThrow({ where: { id: old.id } }))).toEqual(pick(ended));
    expect(await hashes(old.id)).toEqual(oldHashes);
    const lives = await tagged('demo-live');
    expect(lives).toHaveLength(2);
    const fresh = lives.find((lot) => lot.id !== old.id);
    expect(fresh?.status).toBe('OPEN');
    expect(fresh?.currentLeaderPublicId).toBe(DEMO_USERS.ana.publicId);
    expect(fresh?.bidCount).toBe(2);
    expect(await prisma.walletLedger.count({ where: { type: 'DEPOSIT' } })).toBe(3);

    expect((await settlement.finalizeAuction(old.id)).outcome).toBe('SETTLED');
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { auctionId: old.id } });
    expect(receipt.winnerPublicId).not.toBe(DEMO_USERS.ana.publicId);
    expect(await hashes(old.id)).toEqual(oldHashes);
    for (const id of [old.id, fresh?.id ?? '']) {
      expect((await request(server()).get(`/api/auctions/${id}/audit`)).body.verdict).toBe('INTEGRO');
    }
  });

  it('does not leave a live demo with a missing bid when the scripted balance or bid fails', async () => {
    await seed.run();
    const [first] = await tagged('demo-live');
    const settlement = app.get(SettlementService);
    expect((await settlement.markEnded(first.id)).outcome).toBe('ENDED');

    const ana = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_USERS.ana.email } });
    const sellerId = (await prisma.user.findUniqueOrThrow({ where: { email: DEMO_USERS.seller.email } })).id;
    const drain = await app.get(AuctionsService).createFromSnapshot(
      sellerId,
      {
        startingBidCents: 100,
        minIncrementCents: 100,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      },
      { edition: edition('Lote que prende o saldo'), cover: null },
    );
    await app.get(BiddingService).placeBid(ana.id, drain.id, DEMO_DEPOSIT_CENTS - 1_500);

    const short = await seed.run();
    expect(short.created).toEqual([]);
    expect(short.problems).toEqual([expect.stringContaining('demo-live não foi criado')]);
    expect(await tagged('demo-live')).toHaveLength(1);

    await app.get(AuctionsService).cancel(sellerId, drain.id);
    const bidding = app.get(BiddingService);
    const original = bidding.placeBid.bind(bidding);
    let calls = 0;
    jest.spyOn(bidding, 'placeBid').mockImplementation(async (...args) => {
      calls += 1;
      if (calls === 2) {
        throw new Error('falha simulada no segundo lance');
      }
      return original(...args);
    });
    const broken = await seed.run();
    expect(broken.created).toEqual([]);
    const attempts = await tagged('demo-live');
    expect(attempts).toHaveLength(2);
    const cancelled = attempts.find((lot) => lot.id !== first.id);
    expect(cancelled?.status).toBe('CANCELLED');
    expect(cancelled?.bidCount).toBe(1);
    const bruno = await login(DEMO_USERS.bruno.email);
    expect((await request(server()).get('/api/wallet').set(auth(bruno))).body.committedCents).toBe(0);
    expect((await request(server()).get(`/api/auctions/${cancelled?.id}/audit`)).body.verdict).toBe('INTEGRO');

    jest.restoreAllMocks();
    expect((await seed.run()).created).toEqual(['demo-live']);
    const open = (await tagged('demo-live')).filter((lot) => lot.status === 'OPEN' && lot.endsAt > new Date());
    expect(open).toHaveLength(1);
    expect(open[0].bidCount).toBe(2);
  });

  it('searches the snapshot title inside each status and keeps a cancelled lot out', async () => {
    await seed.run();
    const seller = await login(DEMO_USERS.seller.email);
    const [live] = await tagged('demo-live');
    const sellerId = (await prisma.user.findUniqueOrThrow({ where: { email: DEMO_USERS.seller.email } })).id;
    const twin = await app.get(AuctionsService).createFromSnapshot(
      sellerId,
      {
        startingBidCents: 100,
        minIncrementCents: 100,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      },
      { edition: edition('O Alienista, segunda tiragem'), cover: null },
    );
    expect((await request(server()).post(`/api/auctions/${twin.id}/cancel`).set(auth(seller))).status).toBe(200);

    const ids = async (status: string, q: string) => {
      const response = await request(server()).get('/api/auctions').query({ status, q }).set(auth(seller));
      expect(response.status).toBe(200);
      return response.body.map((lot: { id: string }) => lot.id);
    };
    expect(await ids('live', 'aLiEnIsTa')).toEqual([live.id]);
    expect(await ids('scheduled', 'alienista')).toEqual([]);
    expect(await ids('ended', 'alienista')).toEqual([]);
    expect(await ids('ended', 'Sertão')).toEqual([(await tagged('demo-unsold'))[0].id]);
    expect(await ids('live', 'nenhum livro assim')).toEqual([]);
    expect(await ids('live', '   ')).toEqual([live.id]);
    const tooLong = await request(server()).get('/api/auctions').query({ status: 'live', q: 'x'.repeat(101) }).set(auth(seller));
    expect(tooLong.status).toBe(400);
  });
});

async function counts() {
  return {
    auctions: await prisma.auction.count(),
    bids: await prisma.bid.count(),
    deposits: await prisma.walletLedger.count({ where: { type: 'DEPOSIT' } }),
    debits: await prisma.walletLedger.count({ where: { type: 'SETTLEMENT_DEBIT' } }),
    credits: await prisma.walletLedger.count({ where: { type: 'SETTLEMENT_CREDIT' } }),
    receipts: await prisma.receipt.count(),
    users: await prisma.user.count(),
  };
}

function tagged(tag: DemoTag) {
  return prisma.auction.findMany({ where: { demoTag: tag }, orderBy: { createdAt: 'asc' } });
}

async function hashes(auctionId: string) {
  const bids = await prisma.bid.findMany({ where: { auctionId }, orderBy: { sequence: 'asc' } });
  return bids.map((row) => [row.sequence, row.hash, row.previousHash]);
}

function pick(row: { endsAt: Date; version: number; auditHeadHash: string; auditStateMac: string; bidCount: number }) {
  return {
    endsAt: row.endsAt.toISOString(),
    version: row.version,
    auditHeadHash: row.auditHeadHash,
    auditStateMac: row.auditStateMac,
    bidCount: row.bidCount,
  };
}

function edition(title: string) {
  return {
    editionId: 'OL1M',
    workId: 'OL1W',
    title,
    authors: ['Autora'],
    publisher: null,
    publishedDate: null,
    publishedYear: null,
    isbn: null,
    language: null,
    description: null,
  };
}

async function login(email: string) {
  const response = await request(server()).post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  expect(response.status).toBe(200);
  return response.body.accessToken as string;
}

async function register(email: string) {
  const response = await request(server())
    .post('/api/auth/register')
    .send({ name: 'Carla Avaliadora', email, password: 'senha-segura', role: Role.BIDDER });
  expect(response.status).toBe(201);
  return response.body.accessToken as string;
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
