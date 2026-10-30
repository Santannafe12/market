import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module';
import { AUDIT_KEY_VERSION, auditHmac, canonicalGenesis, canonicalState } from '../src/audit/audit';
import { DomainEvents } from '../src/common/domain-events';
import { validateEnv } from '../src/config/env';
import { configureApp } from '../src/configure-app';
import {
  bidStanding,
  refreshRoom,
  RoomSync,
  type AuctionUpdatedEvent,
  type RoomAuction,
  type RoomBid,
} from '../src/realtime/auction-sync';
import { SettlementService } from '../src/settlement/settlement.service';

const prisma = new PrismaClient();
let app: INestApplication;
let baseUrl = '';
const sockets: Socket[] = [];

type AuctionBody = RoomAuction & { serverNow: string; title: string };
type Hint = { auctionId: string | null; reason: string };

describe('realtime room', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, validateEnv(process.env));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('Porta de teste indisponível.');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    app.get(DomainEvents).failEmit = false;
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Receipt", "Bid", "WalletLedger", "Auction", "Wallet", "User" CASCADE',
    );
  });

  afterEach(() => {
    for (const socket of sockets) {
      socket.removeAllListeners();
      socket.disconnect();
    }
    sockets.length = 0;
    app.get(DomainEvents).failEmit = false;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('acks the public room, stays quiet, and delivers the next bid to the other client', async () => {
    const seller = await register(Role.SELLER, 'seller.live@example.com');
    const ana = await register(Role.BIDDER, 'ana.live@example.com');
    const bruno = await register(Role.BIDDER, 'bruno.live@example.com');
    await deposit(ana.accessToken, 20_000);
    await deposit(bruno.accessToken, 20_000);
    const window = await liveWindow(2 * 60 * 60_000);
    const auctionId = await insertAuction(seller.user, {
      startingBidCents: 1_000,
      minIncrementCents: 100,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });

    const anaRoom = new Watcher(auctionId, ana.accessToken);
    const brunoRoom = new Watcher(auctionId);
    await anaRoom.ready();
    await brunoRoom.ready();
    expect(anaRoom.sync.current?.auction.version).toBe(0);
    expect(brunoRoom.sync.current?.auction.version).toBe(0);

    await delay(1_100);
    expect(anaRoom.events).toHaveLength(0);
    expect(brunoRoom.events).toHaveLength(0);

    const opening = await bid(ana.accessToken, auctionId, 1_000);
    expect(opening.status).toBe(201);
    expect(opening.body.auction.currentBidCents).toBe(1_000);
    expect(opening.body.auction.version).toBe(1);
    expect(opening.body.bid.bidderId).toBeUndefined();

    await waitFor(() => brunoRoom.sync.current?.auction.version === 1);
    const event = brunoRoom.events[0];
    expect(event).toMatchObject({
      id: auctionId,
      version: 1,
      status: 'OPEN',
      currentBidCents: 1_000,
      bidCount: 1,
      currentLeaderPublicId: ana.user.publicId,
    });
    expect(event?.bid).toMatchObject({ sequence: 1, bidderPublicId: ana.user.publicId, amountCents: 1_000 });
    expect(event?.bid && 'bidderId' in event.bid).toBe(false);
    expect(Object.keys(event ?? {})).toEqual(
      expect.arrayContaining(['serverNow', 'startsAt', 'endsAt', 'originalEndsAt']),
    );
    expect(JSON.stringify(event)).not.toContain(ana.user.id);
    expect(JSON.stringify(event)).not.toContain(ana.user.email);
    expect(bidStanding({ publicId: ana.user.publicId, role: 'BIDDER' }, event!, event?.bid ? [event.bid] : [])).toBe(
      'leading',
    );

    const raised = await bid(bruno.accessToken, auctionId, 1_100);
    expect(raised.status).toBe(201);
    await waitFor(() => anaRoom.sync.current?.auction.version === 2 && anaRoom.hints.length >= 1);
    expect(anaRoom.hints.every((hint) => hint.auctionId === auctionId && hint.reason === 'refresh')).toBe(true);
    expect(JSON.stringify(anaRoom.hints)).not.toContain('balance');
    expect(anaRoom.sync.current?.auction.currentLeaderPublicId).toBe(bruno.user.publicId);
    expect(anaRoom.sync.current?.auction.currentBidCents).toBe(1_100);
    expect(
      bidStanding(
        { publicId: ana.user.publicId, role: 'BIDDER' },
        anaRoom.sync.current!.auction,
        anaRoom.sync.current!.bids,
      ),
    ).toBe('outbid');
    expect(brunoRoom.hints).toHaveLength(0);
  });

  it('ignores an old event, refetches a skipped version, and refuses a stale snapshot', async () => {
    const seller = await register(Role.SELLER, 'seller.version@example.com');
    const ana = await register(Role.BIDDER, 'ana.version@example.com');
    const bruno = await register(Role.BIDDER, 'bruno.version@example.com');
    await deposit(ana.accessToken, 20_000);
    await deposit(bruno.accessToken, 20_000);
    const window = await liveWindow(2 * 60 * 60_000);
    const auctionId = await insertAuction(seller.user, {
      startingBidCents: 1_000,
      minIncrementCents: 100,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });
    const watcher = new Watcher(auctionId);
    await watcher.ready();

    app.get(DomainEvents).failEmit = 'sync';
    const hidden = await bid(ana.accessToken, auctionId, 1_000);
    expect(hidden.status).toBe(201);
    await delay(100);
    expect(await prisma.bid.count()).toBe(1);
    expect(watcher.events).toHaveLength(0);
    expect(watcher.sync.current?.auction.version).toBe(0);

    app.get(DomainEvents).failEmit = false;
    const visible = await bid(bruno.accessToken, auctionId, 1_100);
    expect(visible.status).toBe(201);
    await waitFor(() => watcher.sync.current?.auction.version === 2);
    expect(watcher.sync.current?.auction.currentBidCents).toBe(1_100);
    expect(watcher.events[0]?.version).toBe(2);

    expect(watcher.sync.noteEvent(watcher.events[0]!)).toBe('ignore');
    expect(watcher.sync.current?.auction.version).toBe(2);

    const current = watcher.sync.current!;
    const stale = watcher.sync.noteSnapshot(
      { ...current.auction, version: 1, bidCount: 1, currentBidCents: 1_000 },
      [],
      current.serverNow,
    );
    expect(stale.applied).toBe(false);
    expect(watcher.sync.current?.auction.version).toBe(2);
    expect(watcher.sync.current?.auction.currentBidCents).toBe(1_100);

    const caughtUp = await refreshRoom(watcher.sync, () => loadAuction(auctionId));
    expect(caughtUp.applied).toBe(false);
    expect(watcher.sync.current?.auction.version).toBe(2);
  });

  it('keeps a committed bid when delivery fails asynchronously', async () => {
    const seller = await register(Role.SELLER, 'seller.async@example.com');
    const ana = await register(Role.BIDDER, 'ana.async@example.com');
    await deposit(ana.accessToken, 5_000);
    const window = await liveWindow(2 * 60 * 60_000);
    const auctionId = await insertAuction(seller.user, {
      startingBidCents: 1_000,
      minIncrementCents: 100,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });
    app.get(DomainEvents).failEmit = 'async';
    const accepted = await bid(ana.accessToken, auctionId, 1_000);
    expect(accepted.status).toBe(201);
    await delay(100);
    expect(await prisma.bid.count({ where: { auctionId } })).toBe(1);
    expect((await prisma.auction.findUniqueOrThrow({ where: { id: auctionId } })).version).toBe(1);
  });

  it('gives the private room only to the authenticated subject', async () => {
    const ana = await register(Role.BIDDER, 'ana.room@example.com');
    const bruno = await register(Role.BIDDER, 'bruno.room@example.com');
    await deposit(ana.accessToken, 1_000);
    await deposit(bruno.accessToken, 1_000);

    const anaHints: Hint[] = [];
    const brunoHints: Hint[] = [];
    const impostorHints: Hint[] = [];
    const invalidHints: Hint[] = [];
    const expiredHints: Hint[] = [];
    const anaSocket = userSocket(ana.accessToken);
    const brunoSocket = userSocket(bruno.accessToken);
    const impostor = userSocket(ana.accessToken, { userId: bruno.user.id });
    const invalid = userSocket('not-a-jwt');
    const expired = userSocket(expiredToken(ana.user));
    anaSocket.on('wallet.hint', (hint: Hint) => anaHints.push(hint));
    brunoSocket.on('wallet.hint', (hint: Hint) => brunoHints.push(hint));
    impostor.on('wallet.hint', (hint: Hint) => impostorHints.push(hint));
    invalid.on('wallet.hint', (hint: Hint) => invalidHints.push(hint));
    expired.on('wallet.hint', (hint: Hint) => expiredHints.push(hint));
    await Promise.all([anaSocket, brunoSocket, impostor, invalid, expired].map(untilConnected));

    anaSocket.emit('user.join', { userId: bruno.user.id });
    const brunoDeposit = await deposit(bruno.accessToken, 500);
    expect(brunoDeposit.status).toBe(201);
    await waitFor(() => brunoHints.length === 1);
    await delay(150);
    expect(brunoHints).toEqual([{ auctionId: null, reason: 'refresh' }]);
    expect(anaHints).toHaveLength(0);
    expect(impostorHints).toHaveLength(0);
    expect(invalidHints).toHaveLength(0);
    expect(expiredHints).toHaveLength(0);

    const anaDeposit = await deposit(ana.accessToken, 500);
    expect(anaDeposit.status).toBe(201);
    await waitFor(() => anaHints.length === 1 && impostorHints.length === 1);
    await delay(150);
    expect(brunoHints).toHaveLength(1);
    expect(invalidHints).toHaveLength(0);
    expect(expiredHints).toHaveLength(0);
    expect(JSON.stringify(anaHints[0])).not.toContain(ana.user.id);
  });

  it('emits the settled status and the room reaches it through a version gap', async () => {
    const seller = await register(Role.SELLER, 'seller.settle.room@example.com');
    const ana = await register(Role.BIDDER, 'ana.settle.room@example.com');
    await deposit(ana.accessToken, 5_000);
    const window = await liveWindow(2 * 60 * 60_000);
    const auctionId = await insertAuction(seller.user, {
      startingBidCents: 1_000,
      minIncrementCents: 100,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });
    const watcher = new Watcher(auctionId);
    await watcher.ready();
    expect((await bid(ana.accessToken, auctionId, 1_000)).status).toBe(201);
    await waitFor(() => watcher.sync.current?.auction.version === 1);

    const settlement = app.get(SettlementService);
    expect((await settlement.markEnded(auctionId)).outcome).toBe('ENDED');
    expect((await settlement.finalizeAuction(auctionId)).outcome).toBe('SETTLED');
    await waitFor(() => watcher.events.some((event) => event.status === 'SETTLED'));
    await watcher.idle();
    expect(watcher.sync.current?.auction.status).toBe('SETTLED');
    expect(watcher.sync.current?.auction.version).toBeGreaterThan(1);
    expect(JSON.stringify(watcher.events)).not.toContain(ana.user.id);
  });

  it('reconnects and replaces the room with the authoritative snapshot', async () => {
    const seller = await register(Role.SELLER, 'seller.reconnect@example.com');
    const ana = await register(Role.BIDDER, 'ana.reconnect@example.com');
    await deposit(ana.accessToken, 5_000);
    const window = await liveWindow(2 * 60 * 60_000);
    const auctionId = await insertAuction(seller.user, {
      startingBidCents: 1_000,
      minIncrementCents: 100,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });
    const watcher = new Watcher(auctionId);
    await watcher.ready();
    watcher.socket.disconnect();
    expect((await bid(ana.accessToken, auctionId, 1_000)).status).toBe(201);
    expect(watcher.sync.current?.auction.version).toBe(0);
    await watcher.ready();
    expect(watcher.sync.current?.auction.version).toBe(1);
    expect(watcher.sync.current?.auction.currentBidCents).toBe(1_000);
    expect(watcher.sync.current?.bids).toHaveLength(1);
  });

  it('opens the lot and its bids without a token and keeps financial commands private', async () => {
    const seller = await register(Role.SELLER, 'seller.public@example.com');
    const ana = await register(Role.BIDDER, 'ana.public@example.com');
    await deposit(ana.accessToken, 5_000);
    const window = await liveWindow(2 * 60 * 60_000);
    const auctionId = await insertAuction(seller.user, {
      startingBidCents: 1_000,
      minIncrementCents: 100,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });
    expect((await bid(ana.accessToken, auctionId, 1_000)).status).toBe(201);

    const detail = await request(server()).get(`/api/auctions/${auctionId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.serverNow).toEqual(expect.any(String));
    expect(detail.body.currentBidCents).toBe(1_000);
    expect(detail.body.currentLeaderPublicId).toBe(ana.user.publicId);
    expect(JSON.stringify(detail.body)).not.toContain(ana.user.id);
    expect(JSON.stringify(detail.body)).not.toContain(seller.user.id);

    const history = await request(server()).get(`/api/auctions/${auctionId}/bids`);
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].bidderId).toBeUndefined();
    expect(JSON.stringify(history.body)).not.toContain(ana.user.email);

    expect((await request(server()).get('/api/wallet')).status).toBe(401);
    expect((await request(server()).post('/api/wallet/deposits').send({ amountCents: 100 })).status).toBe(401);
    expect((await request(server()).post(`/api/auctions/${auctionId}/bids`).send({ amountCents: 1_100 })).status).toBe(
      401,
    );
    expect((await request(server()).get('/api/auctions/mine')).status).toBe(401);
    expect((await request(server()).get('/api/auctions?status=live')).status).toBe(401);
    expect((await request(server()).get(`/api/auctions/${auctionId}/audit`)).status).toBe(200);
  });
});

class Watcher {
  readonly sync = new RoomSync<AuctionBody>();
  readonly events: AuctionUpdatedEvent[] = [];
  readonly hints: Hint[] = [];
  readonly socket: Socket;
  private chain: Promise<void> = Promise.resolve();
  private failure: unknown = null;

  constructor(
    private readonly auctionId: string,
    token?: string,
  ) {
    this.socket = openSocket(token);
    this.socket.on('connect', () => {
      this.failure = null;
      this.chain = this.chain
        .then(() => this.enter())
        .catch((error: unknown) => {
          this.failure = error;
        });
    });
    this.socket.on('auction.updated', (event: AuctionUpdatedEvent) => {
      this.events.push(event);
      const kind = this.sync.noteEvent(event);
      if (kind === 'refetch') {
        this.chain = this.chain
          .then(() => refreshRoom(this.sync, () => loadAuction(this.auctionId)))
          .then(() => undefined)
          .catch((error: unknown) => {
            this.failure = error;
          });
      }
    });
    this.socket.on('wallet.hint', (hint: Hint) => {
      this.hints.push(hint);
    });
  }

  async ready() {
    if (!this.socket.connected) {
      const connectedPromise = connected(this.socket);
      this.socket.connect();
      await connectedPromise;
    }
    await this.idle();
  }

  async idle() {
    await this.chain;
    if (this.failure) {
      throw this.failure;
    }
  }

  private async enter() {
    const ack = (await this.socket.timeout(5_000).emitWithAck('auction.join', {
      auctionId: this.auctionId,
    })) as { ok?: boolean };
    if (!ack?.ok) {
      throw new Error('A sala não confirmou a entrada.');
    }
    await refreshRoom(this.sync, () => loadAuction(this.auctionId));
  }
}

function openSocket(token?: string, extraAuth?: Record<string, string>) {
  const socket = io(baseUrl, {
    autoConnect: false,
    forceNew: true,
    transports: ['websocket'],
    auth: { ...(token ? { token } : {}), ...extraAuth },
    extraHeaders: { Origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' },
  });
  sockets.push(socket);
  return socket;
}

function userSocket(token: string, extraAuth?: Record<string, string>) {
  return openSocket(token, extraAuth);
}

function untilConnected(socket: Socket) {
  if (socket.connected) {
    return Promise.resolve();
  }
  const pending = connected(socket);
  socket.connect();
  return pending;
}

function connected(socket: Socket) {
  if (socket.connected) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tempo esgotado ao conectar.')), 5_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function expiredToken(user: { id: string; publicId: string }) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is missing');
  }
  return jwt.sign({ sub: user.id, role: Role.BIDDER, publicId: user.publicId, exp: 1 }, secret);
}

async function loadAuction(auctionId: string) {
  const detail = await request(server()).get(`/api/auctions/${auctionId}`);
  const history = await request(server()).get(`/api/auctions/${auctionId}/bids`);
  if (detail.status !== 200 || history.status !== 200) {
    throw new Error(`Falha ao ler o lote: ${detail.status}/${history.status}`);
  }
  return {
    auction: detail.body as AuctionBody,
    bids: history.body as RoomBid[],
    serverNow: String(detail.body.serverNow),
  };
}

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    await delay(20);
  }
  throw new Error('Tempo esgotado aguardando a sala.');
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const { randomUUID } = await import('crypto');
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
