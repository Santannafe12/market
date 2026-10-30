import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  AUDIT_KEY_VERSION,
  auditHmac,
  canonicalGenesis,
  canonicalState,
  verifyAuction,
} from '../src/audit/audit';
import { BiddingService } from '../src/bidding/bidding.service';
import { MONEY_MAX_CENTS } from '../src/common/money';
import { validateEnv } from '../src/config/env';
import { configureApp } from '../src/configure-app';

const prisma = new PrismaClient();
let app: INestApplication;

describe('wallet and bids', () => {
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
    app.get(BiddingService).failBeforeCommit = false;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('accepts the opening bid and the exact increment, and rejects a short bid, a self-raise, a seller, or a closed window', async () => {
    const seller = await register(Role.SELLER, 'seller.rules@example.com');
    const ana = await register(Role.BIDDER, 'ana.rules@example.com');
    const bruno = await register(Role.BIDDER, 'bruno.rules@example.com');
    await deposit(ana.accessToken, 20_000);
    await deposit(bruno.accessToken, 20_000);
    const empty = await wallet(ana.accessToken);
    expect(empty.body).toEqual({ balanceCents: 20_000, committedCents: 0, availableCents: 20_000 });

    const window = await liveWindow(2 * 60 * 60_000);
    const auctionId = await insertAuction(seller.user, {
      startingBidCents: 1500,
      minIncrementCents: 100,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });

    const short = await bid(ana.accessToken, auctionId, 1499);
    expect(short.status).toBe(422);
    expect(short.body.code).toBe('BID_BELOW_STARTING');
    expect(short.body.message).toMatch(/lance inicial/i);
    expect(await prisma.bid.count()).toBe(0);

    const opening = await bid(ana.accessToken, auctionId, 1500);
    expect(opening.status).toBe(201);
    expect(opening.body.bid).toMatchObject({
      sequence: 1,
      bidderPublicId: ana.user.publicId,
      amountCents: 1500,
    });
    expect(opening.body.bid.bidderId).toBeUndefined();
    expect(opening.body.wallet).toEqual({ balanceCents: 20_000, committedCents: 1500, availableCents: 18_500 });
    expect(JSON.stringify(opening.body)).not.toContain(ana.user.id);

    const below = await bid(bruno.accessToken, auctionId, 1599);
    expect(below.status).toBe(422);
    expect(below.body.code).toBe('BID_BELOW_INCREMENT');
    expect(below.body.message).toMatch(/incremento/i);

    const raised = await bid(bruno.accessToken, auctionId, 1600);
    expect(raised.status).toBe(201);
    expect(raised.body.bid.sequence).toBe(2);
    expect(raised.body.auction.currentLeaderPublicId).toBe(bruno.user.publicId);

    const own = await bid(bruno.accessToken, auctionId, 1700);
    expect(own.status).toBe(422);
    expect(own.body.code).toBe('BID_LEADER_CANNOT_RAISE');
    expect(own.body.message).toMatch(/ganhando/i);

    const sellerBid = await bid(seller.accessToken, auctionId, 2000);
    expect(sellerBid.status).toBe(403);
    expect(sellerBid.body.code).toBe('SELLER_CANNOT_BID');

    const history = await request(server()).get(`/api/auctions/${auctionId}/bids`).set(auth(ana.accessToken));
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(2);
    expect(JSON.stringify(history.body)).not.toContain(ana.user.id);
    expect(JSON.stringify(history.body)).not.toContain(bruno.user.email);
    expect((await verdict(auctionId)).verdict).toBe('INTEGRO');

    const future = await liveWindow(2 * 60 * 60_000);
    const scheduledId = await insertAuction(seller.user, {
      startingBidCents: 1500,
      minIncrementCents: 100,
      startsAt: new Date(future.now.getTime() + 60 * 60_000),
      endsAt: new Date(future.now.getTime() + 2 * 60 * 60_000),
    });
    const tooEarly = await bid(ana.accessToken, scheduledId, 1500);
    expect(tooEarly.status).toBe(422);
    expect(tooEarly.body.code).toBe('AUCTION_NOT_STARTED');

    const past = await liveWindow(60_000);
    const endedId = await insertAuction(seller.user, {
      startingBidCents: 1500,
      minIncrementCents: 100,
      startsAt: new Date(past.now.getTime() - 2 * 60 * 60_000),
      endsAt: new Date(past.now.getTime() - 60_000),
    });
    const tooLate = await bid(ana.accessToken, endedId, 1500);
    expect(tooLate.status).toBe(422);
    expect(tooLate.body.code).toBe('AUCTION_ENDED');
    expect(await prisma.bid.count({ where: { auctionId: { in: [scheduledId, endedId] } } })).toBe(0);
  });

  it('commits the whole offer, refuses a bid the balance cannot cover, and releases the previous leader without a credit', async () => {
    const seller = await register(Role.SELLER, 'seller.money@example.com');
    const poor = await register(Role.BIDDER, 'poor.money@example.com');
    const ana = await register(Role.BIDDER, 'ana.money@example.com');
    const bruno = await register(Role.BIDDER, 'bruno.money@example.com');
    await deposit(poor.accessToken, 1_000);
    await deposit(ana.accessToken, 10_000);
    await deposit(bruno.accessToken, 10_000);
    const window = await liveWindow(2 * 60 * 60_000);
    const auctionId = await insertAuction(seller.user, {
      startingBidCents: 4_000,
      minIncrementCents: 500,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });
    const before = await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } });

    const denied = await bid(poor.accessToken, auctionId, 4_000);
    expect(denied.status).toBe(422);
    expect(denied.body.code).toBe('INSUFFICIENT_AVAILABLE_BALANCE');
    expect(denied.body.message).toMatch(/disponível/i);
    const untouched = await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } });
    expect(untouched.auditHeadHash).toBe(before.auditHeadHash);
    expect(untouched.auditStateMac).toBe(before.auditStateMac);
    expect(untouched.version).toBe(0);
    expect(await prisma.bid.count()).toBe(0);

    const anaBid = await bid(ana.accessToken, auctionId, 5_000);
    expect(anaBid.status).toBe(201);
    expect(anaBid.body.wallet).toEqual({ balanceCents: 10_000, committedCents: 5_000, availableCents: 5_000 });

    const brunoBid = await bid(bruno.accessToken, auctionId, 5_500);
    expect(brunoBid.status).toBe(201);
    expect(brunoBid.body.wallet.committedCents).toBe(5_500);

    const anaWallet = await wallet(ana.accessToken);
    expect(anaWallet.body).toEqual({ balanceCents: 10_000, committedCents: 0, availableCents: 10_000 });
    expect(await prisma.walletLedger.count({ where: { wallet: { userId: ana.user.id } } })).toBe(1);
    expect(await prisma.walletLedger.findFirstOrThrow({ where: { wallet: { userId: ana.user.id } } })).toMatchObject({
      type: 'DEPOSIT',
      amountCents: 10_000,
    });
  });

  it('extends a lot inside the final two minutes, leaves a distant end in place, and rolls the extension back with the bid', async () => {
    const seller = await register(Role.SELLER, 'seller.snipe@example.com');
    const ana = await register(Role.BIDDER, 'ana.snipe@example.com');
    await deposit(ana.accessToken, 20_000);

    const soon = await liveWindow(30_000);
    const soonId = await insertAuction(seller.user, {
      startingBidCents: 1_000,
      minIncrementCents: 100,
      startsAt: soon.startsAt,
      endsAt: soon.endsAt,
    });
    const extended = await bid(ana.accessToken, soonId, 1_000);
    expect(extended.status).toBe(201);
    const soonRow = await prisma.auction.findUniqueOrThrow({ where: { id: soonId } });
    expect(soonRow.originalEndsAt.getTime()).toBe(soon.endsAt.getTime());
    expect(soonRow.endsAt.getTime()).toBe(soon.endsAt.getTime() + 120_000);
    expect(extended.body.auction.endsAt).toBe(soonRow.endsAt.toISOString());
    expect((await verdict(soonId)).verdict).toBe('INTEGRO');

    const distant = await liveWindow(10 * 60_000);
    const distantId = await insertAuction(seller.user, {
      startingBidCents: 1_000,
      minIncrementCents: 100,
      startsAt: distant.startsAt,
      endsAt: distant.endsAt,
    });
    const steady = await bid(ana.accessToken, distantId, 1_000);
    expect(steady.status).toBe(201);
    const distantRow = await prisma.auction.findUniqueOrThrow({ where: { id: distantId } });
    expect(distantRow.endsAt.getTime()).toBe(distant.endsAt.getTime());
    expect(distantRow.originalEndsAt.getTime()).toBe(distant.endsAt.getTime());

    const rollbackWindow = await liveWindow(30_000);
    const rollbackId = await insertAuction(seller.user, {
      startingBidCents: 1_000,
      minIncrementCents: 100,
      startsAt: rollbackWindow.startsAt,
      endsAt: rollbackWindow.endsAt,
    });
    app.get(BiddingService).failBeforeCommit = true;
    await expect(app.get(BiddingService).placeBid(ana.user.id, rollbackId, 1_000)).rejects.toThrow(
      'forced rollback',
    );
    const rolled = await prisma.auction.findUniqueOrThrow({ where: { id: rollbackId } });
    expect(rolled.endsAt.getTime()).toBe(rollbackWindow.endsAt.getTime());
    expect(rolled.originalEndsAt.getTime()).toBe(rollbackWindow.endsAt.getTime());
    expect(rolled.bidCount).toBe(0);
    expect(rolled.version).toBe(0);
    expect(await prisma.bid.count({ where: { auctionId: rollbackId } })).toBe(0);
  });

  it('rejects the bid that waited on the wallet lock until the lot had already ended', async () => {
    const seller = await register(Role.SELLER, 'seller.lock@example.com');
    const ana = await register(Role.BIDDER, 'ana.lock@example.com');
    await deposit(ana.accessToken, 10_000);
    const window = await liveWindow(12_000);
    const auctionId = await insertAuction(seller.user, {
      startingBidCents: 1_000,
      minIncrementCents: 100,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });
    const before = await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } });
    expect((await dbNow()).getTime()).toBeLessThan(before.endsAt.getTime());

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    let open = true;
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM "Wallet" WHERE "userId" = $1 FOR UPDATE', [ana.user.id]);
      const started = Date.now();
      const pending = request(server())
        .post(`/api/auctions/${auctionId}/bids`)
        .set(auth(ana.accessToken))
        .send({ amountCents: 1_000 })
        .then((res) => ({ res, ms: Date.now() - started }));

      expect(await waitForWalletWaiter(8_000)).toBe(true);
      const latest = await dbNow();
      const seconds = Math.max(before.endsAt.getTime() - latest.getTime(), 0) / 1000 + 1.5;
      expect(seconds).toBeLessThan(20);
      const sleepStarted = Date.now();
      await client.query('SELECT pg_sleep($1)', [seconds]);
      const slept = Date.now() - sleepStarted;
      await client.query('COMMIT');
      open = false;

      const { res, ms } = await pending;
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('AUCTION_ENDED');
      expect(ms).toBeGreaterThan(slept - 500);
    } finally {
      if (open) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      await client.end();
    }

    const after = await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } });
    expect(after.endsAt.getTime()).toBe(before.endsAt.getTime());
    expect(after.originalEndsAt.getTime()).toBe(before.originalEndsAt.getTime());
    expect(after.bidCount).toBe(0);
    expect(after.auditHeadHash).toBe(before.auditHeadHash);
    expect(await prisma.bid.count({ where: { auctionId } })).toBe(0);
  }, 60_000);

  it('lets exactly one of two simultaneous bids from the same bidder spend a balance that covers only one lot', async () => {
    const seller = await register(Role.SELLER, 'seller.race@example.com');
    const ana = await register(Role.BIDDER, 'ana.race@example.com');
    await deposit(ana.accessToken, 5_000);
    const window = await liveWindow(2 * 60 * 60_000);
    const firstId = await insertAuction(seller.user, {
      startingBidCents: 4_000,
      minIncrementCents: 100,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });
    const secondId = await insertAuction(seller.user, {
      startingBidCents: 4_000,
      minIncrementCents: 100,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });

    const [first, second] = await Promise.all([
      bid(ana.accessToken, firstId, 4_000),
      bid(ana.accessToken, secondId, 4_000),
    ]);
    const accepted = [first, second].filter((response) => response.status === 201);
    const refused = [first, second].filter((response) => response.status === 422);
    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.body.code).toBe('INSUFFICIENT_AVAILABLE_BALANCE');

    const view = await wallet(ana.accessToken);
    expect(view.body).toEqual({ balanceCents: 5_000, committedCents: 4_000, availableCents: 1_000 });
    expect(await prisma.bid.count()).toBe(1);
  });

  it('serializes simultaneous bids on one lot into one continuous chain', async () => {
    const seller = await register(Role.SELLER, 'seller.chain@example.com');
    const ana = await register(Role.BIDDER, 'ana.chain@example.com');
    const bruno = await register(Role.BIDDER, 'bruno.chain@example.com');
    await deposit(ana.accessToken, 100_000);
    await deposit(bruno.accessToken, 100_000);
    const window = await liveWindow(2 * 60 * 60_000);
    const auctionId = await insertAuction(seller.user, {
      startingBidCents: 1_000,
      minIncrementCents: 100,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });

    const amounts = [1_000, 1_200, 1_400, 1_600, 1_800, 2_000, 2_200, 2_400];
    const responses = await Promise.all(
      amounts.map((amount, index) =>
        bid(index % 2 === 0 ? ana.accessToken : bruno.accessToken, auctionId, amount),
      ),
    );
    for (const response of responses) {
      expect([201, 422]).toContain(response.status);
      if (response.status === 422) {
        expect(['BID_BELOW_INCREMENT', 'BID_LEADER_CANNOT_RAISE']).toContain(response.body.code);
      }
    }

    const bids = await prisma.bid.findMany({ where: { auctionId }, orderBy: { sequence: 'asc' } });
    expect(bids.length).toBeGreaterThan(0);
    expect(bids.map((row) => row.sequence)).toEqual(bids.map((_, index) => index + 1));
    expect(bids[0]?.amountCents).toBeGreaterThanOrEqual(1_000);
    for (let index = 1; index < bids.length; index += 1) {
      expect(bids[index]?.amountCents).toBeGreaterThanOrEqual((bids[index - 1]?.amountCents ?? 0) + 100);
    }
    const last = bids[bids.length - 1];
    const auction = await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } });
    expect(auction.bidCount).toBe(bids.length);
    expect(auction.currentBidCents).toBe(last?.amountCents);
    expect(auction.currentLeaderId).toBe(last?.bidderId);
    expect((await verdict(auctionId)).verdict).toBe('INTEGRO');

    const leaderToken = last?.bidderId === ana.user.id ? ana.accessToken : bruno.accessToken;
    const otherToken = leaderToken === ana.accessToken ? bruno.accessToken : ana.accessToken;
    expect((await wallet(leaderToken)).body.committedCents).toBe(last?.amountCents);
    expect((await wallet(otherToken)).body.committedCents).toBe(0);
    expect((await wallet(ana.accessToken)).body.balanceCents).toBe(100_000);
    expect((await wallet(bruno.accessToken)).body.balanceCents).toBe(100_000);
  });

  it('rejects deposits and bids that would pass the money cap, including two deposits racing past it', async () => {
    const seller = await register(Role.SELLER, 'seller.cap@example.com');
    const ana = await register(Role.BIDDER, 'ana.cap@example.com');
    const denied = await deposit(seller.accessToken, 100);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORBIDDEN');

    const zero = await deposit(ana.accessToken, 0);
    expect(zero.status).toBe(422);
    expect(zero.body.code).toBe('AMOUNT_INVALID');
    const negative = await deposit(ana.accessToken, -5);
    expect(negative.status).toBe(422);
    expect(negative.body.code).toBe('AMOUNT_INVALID');

    await prisma.wallet.update({
      where: { userId: ana.user.id },
      data: { balanceCents: MONEY_MAX_CENTS - 10 },
    });
    const overflow = await deposit(ana.accessToken, 11);
    expect(overflow.status).toBe(422);
    expect(overflow.body.code).toBe('AMOUNT_OVERFLOW');
    expect((await wallet(ana.accessToken)).body.balanceCents).toBe(MONEY_MAX_CENTS - 10);

    const [left, right] = await Promise.all([deposit(ana.accessToken, 8), deposit(ana.accessToken, 8)]);
    const codes = [left, right].map((response) => (response.status === 201 ? 'OK' : response.body.code));
    expect(codes.filter((code) => code === 'OK')).toHaveLength(1);
    expect(codes.filter((code) => code === 'AMOUNT_OVERFLOW')).toHaveLength(1);
    expect([left.status, right.status].every((status) => status === 201 || status === 422)).toBe(true);
    const after = await wallet(ana.accessToken);
    expect(after.body.balanceCents).toBe(MONEY_MAX_CENTS - 2);
    expect(after.body.balanceCents).toBeLessThanOrEqual(MONEY_MAX_CENTS);

    const window = await liveWindow(2 * 60 * 60_000);
    const auctionId = await insertAuction(seller.user, {
      startingBidCents: 1_000,
      minIncrementCents: 100,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });
    const huge = await bid(ana.accessToken, auctionId, MONEY_MAX_CENTS + 1);
    expect(huge.status).toBe(422);
    expect(huge.body.code).toBe('AMOUNT_OVERFLOW');
    expect(await prisma.bid.count({ where: { auctionId } })).toBe(0);

    await prisma.auction.update({
      where: { id: auctionId },
      data: {
        currentBidCents: MONEY_MAX_CENTS - 5,
        bidCount: 1,
        currentLeaderId: seller.user.id,
        currentLeaderPublicId: seller.user.publicId,
      },
    });
    const next = await bid(ana.accessToken, auctionId, MONEY_MAX_CENTS);
    expect(next.status).toBe(422);
    expect(next.body.code).toBe('AMOUNT_OVERFLOW');
    expect(await prisma.bid.count({ where: { auctionId } })).toBe(0);
    const head = await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } });
    expect(head.auditHeadHash).toBe(
      auditHmac(secret(), canonicalGenesis(auctionId)),
    );
  });

  it('keeps a legitimate chain intact and refuses a new bid after the leader id is tampered', async () => {
    const seller = await register(Role.SELLER, 'seller.mac@example.com');
    const ana = await register(Role.BIDDER, 'ana.mac@example.com');
    const bruno = await register(Role.BIDDER, 'bruno.mac@example.com');
    const carla = await register(Role.BIDDER, 'carla.mac@example.com');
    await deposit(ana.accessToken, 20_000);
    await deposit(bruno.accessToken, 20_000);
    await deposit(carla.accessToken, 20_000);
    const window = await liveWindow(2 * 60 * 60_000);
    const auctionId = await insertAuction(seller.user, {
      startingBidCents: 1_000,
      minIncrementCents: 100,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });
    expect((await bid(ana.accessToken, auctionId, 1_000)).status).toBe(201);
    expect((await bid(bruno.accessToken, auctionId, 1_100)).status).toBe(201);
    const intact = await verdict(auctionId);
    expect(intact.verdict).toBe('INTEGRO');
    const head = intact.row.auditHeadHash;

    await prisma.$executeRaw`
      UPDATE "Auction"
      SET "currentLeaderId" = CAST(${randomUUID()} AS uuid)
      WHERE id = CAST(${auctionId} AS uuid)
    `;
    const refused = await bid(carla.accessToken, auctionId, 1_200);
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('AUCTION_INTEGRITY');
    const after = await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } });
    expect(after.auditHeadHash).toBe(head);
    expect(after.auditStateMac).toBe(intact.row.auditStateMac);
    expect(after.bidCount).toBe(2);
    expect(await prisma.bid.count({ where: { auctionId } })).toBe(2);
    expect((await verdict(auctionId)).verdict).toBe('ADULTERADO');
  });
});

async function register(role: Role, email: string) {
  const response = await request(server())
    .post('/api/auth/register')
    .send({
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
  input: { startingBidCents: number; minIncrementCents: number; startsAt: Date; endsAt: Date },
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
      title: 'Lote de teste',
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
  return {
    row,
    verdict: verifyAuction(row, new Map([[AUDIT_KEY_VERSION, secret()]]), bids),
  };
}

async function waitForWalletWaiter(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT COUNT(*)::int AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
    `;
    if (Number(rows[0]?.waiting ?? 0) > 0) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}
