import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AUDIT_KEY_VERSION, verifyAuction } from '../src/audit/audit';
import { AppModule } from '../src/app.module';
import { CATALOG_FETCH, CatalogClient } from '../src/catalog/catalog.client';
import { MONEY_MAX_CENTS } from '../src/common/money';
import { validateEnv } from '../src/config/env';
import { configureApp } from '../src/configure-app';

const { assertTestDatabaseUrl } = require('./assert-test-database') as {
  assertTestDatabaseUrl: (connectionString: string | undefined) => { name: string };
};

const EDITION_ID = 'OL7353617M';
const WORK_ID = 'OL45804W';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

type Mode = 'ok' | 'fail' | 'no-cover';

const prisma = new PrismaClient();
let httpApp: INestApplication | undefined;
let mode: Mode = 'ok';
let calls: string[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock: typeof fetch = async (input) => {
  const url = String(input);
  calls.push(url);
  if (mode === 'fail') {
    return new Response('down', { status: 500 });
  }
  if (url.includes('covers.openlibrary.org')) {
    if (mode === 'no-cover') {
      return new Response('missing', { status: 404 });
    }
    return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
  }
  if (url.includes('/search.json')) {
    return json({
      docs: [
        {
          key: `/works/${WORK_ID}`,
          title: 'Fantastic Mr Fox',
          author_name: ['Roald Dahl'],
          first_publish_year: 1970,
        },
      ],
    });
  }
  if (url.includes('/editions.json')) {
    return json({
      entries: [
        {
          key: `/books/${EDITION_ID}`,
          title: 'Fantastic Mr. Fox',
          publish_date: 'October 1, 1988',
          publishers: ['Puffin'],
          isbn_13: ['9780140328721'],
          languages: [{ key: '/languages/eng' }],
        },
      ],
    });
  }
  if (url.includes('/books/')) {
    return json({
      key: `/books/${EDITION_ID}`,
      title: 'Fantastic Mr. Fox',
      authors: [{ key: '/authors/OL34184A' }],
      publishers: ['Puffin'],
      publish_date: 'October 1, 1988',
      isbn_13: ['9780140328721'],
      languages: [{ key: '/languages/eng' }],
      works: [{ key: `/works/${WORK_ID}` }],
      covers: [15152634],
      description: { type: '/type/text', value: '<p>Uma raposa <b>esperta</b>.</p>' },
    });
  }
  if (url.includes('/authors/')) {
    return json({ name: 'Roald Dahl' });
  }
  return new Response('missing', { status: 500 });
};

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    editionId: EDITION_ID,
    startingBidCents: 1500,
    minIncrementCents: 100,
    startsAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    endsAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    ...overrides,
  };
}

describe('Auctions HTTP', () => {
  let app: INestApplication;
  let catalog: CatalogClient;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CATALOG_FETCH)
      .useValue(fetchMock)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app, validateEnv(process.env));
    await app.init();
    catalog = app.get(CatalogClient);
    httpApp = app;
  });

  beforeEach(async () => {
    assertTestDatabaseUrl(process.env.DATABASE_URL);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Auction", "Wallet", "User" CASCADE');
    catalog.clearCache();
    mode = 'ok';
    calls = [];
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('stores the edition fetched by the server and keeps that snapshot when Open Library fails', async () => {
    const seller = await register(Role.SELLER, 'helena@example.com');
    const bidder = await register(Role.BIDDER, 'bruno@example.com');

    const forged = await request(app.getHttpServer())
      .post('/api/auctions')
      .set(auth(seller.accessToken))
      .send({ ...createBody(), title: 'Titulo forjado pelo navegador' });
    expect(forged.status).toBe(400);
    expect(forged.body.code).toBe('VALIDATION_ERROR');
    expect(await prisma.auction.count()).toBe(0);

    const denied = await request(app.getHttpServer())
      .get('/api/catalog/search?q=fox')
      .set(auth(bidder.accessToken));
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORBIDDEN');

    const search = await request(app.getHttpServer())
      .get('/api/catalog/search?q=fox')
      .set(auth(seller.accessToken));
    expect(search.status).toBe(200);
    expect(search.body[0].workId).toBe(WORK_ID);

    const editions = await request(app.getHttpServer())
      .get(`/api/catalog/works/${WORK_ID}/editions`)
      .set(auth(seller.accessToken));
    expect(editions.body[0].editionId).toBe(EDITION_ID);

    const preview = await request(app.getHttpServer())
      .get(`/api/catalog/editions/${EDITION_ID}`)
      .set(auth(seller.accessToken));
    expect(preview.body).toMatchObject({
      title: 'Fantastic Mr. Fox',
      authors: ['Roald Dahl'],
      description: 'Uma raposa esperta.',
    });
    expect(preview.body.coverId).toBeUndefined();

    const created = await request(app.getHttpServer())
      .post('/api/auctions')
      .set(auth(seller.accessToken))
      .send(createBody());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      title: 'Fantastic Mr. Fox',
      authors: ['Roald Dahl'],
      publisher: 'Puffin',
      publishedYear: 1988,
      isbn: '9780140328721',
      language: 'eng',
      description: 'Uma raposa esperta.',
      editionId: EDITION_ID,
      workId: WORK_ID,
      sellerPublicId: seller.user.publicId,
      startingBidCents: 1500,
      minIncrementCents: 100,
      currentBidCents: null,
      bidCount: 0,
      version: 0,
      displayStatus: 'live',
    });
    expect(created.body.originalEndsAt).toBe(created.body.endsAt);
    const serialized = JSON.stringify(created.body);
    expect(serialized).not.toContain(seller.user.id);
    expect(serialized).not.toContain(seller.user.email);
    expect(serialized).not.toContain('Helena');
    expect(serialized).not.toContain('auditHeadHash');
    expect(serialized).not.toContain('auditStateMac');
    expect(serialized).not.toContain('"sellerId"');
    expect(serialized).not.toContain('"currentLeaderId"');

    const stored = await prisma.auction.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.title).toBe('Fantastic Mr. Fox');
    expect(stored.description).toBe('Uma raposa esperta.');
    expect(await anchor(stored.id)).toBe('INTEGRO');

    catalog.clearCache();
    mode = 'fail';
    calls = [];
    const detail = await request(app.getHttpServer())
      .get(`/api/auctions/${created.body.id}`)
      .set(auth(seller.accessToken));
    expect(detail.status).toBe(200);
    expect(detail.body.title).toBe('Fantastic Mr. Fox');
    expect(detail.body.description).toBe('Uma raposa esperta.');
    expect(calls).toEqual([]);

    const again = await request(app.getHttpServer())
      .post('/api/auctions')
      .set(auth(seller.accessToken))
      .send(createBody());
    expect(again.status).toBe(503);
    expect(again.body.code).toBe('CATALOG_UNAVAILABLE');

    const live = await request(app.getHttpServer())
      .get('/api/auctions?status=live')
      .set(auth(bidder.accessToken));
    expect(live.status).toBe(200);
    expect(live.body.map((auction: { id: string }) => auction.id)).toEqual([created.body.id]);
    expect(await prisma.auction.count()).toBe(1);
  });

  it('serves a saved cover without calling Open Library again and still creates a lot when the cover is missing', async () => {
    const seller = await register(Role.SELLER, 'helena@example.com');
    const created = await request(app.getHttpServer())
      .post('/api/auctions')
      .set(auth(seller.accessToken))
      .send(createBody());
    expect(created.status).toBe(201);
    expect(created.body.hasCover).toBe(true);
    expect(calls.filter((url) => url.includes('covers.openlibrary.org'))).toHaveLength(1);

    catalog.clearCache();
    mode = 'fail';
    calls = [];
    const cover = await readCover(`/api/auctions/${created.body.id}/cover`);
    expect(cover.status).toBe(200);
    expect(cover.headers['content-type']).toMatch(/image\/png/);
    expect(cover.body.equals(PNG)).toBe(true);
    expect(calls).toEqual([]);

    mode = 'no-cover';
    const withoutCover = await request(app.getHttpServer())
      .post('/api/auctions')
      .set(auth(seller.accessToken))
      .send(createBody());
    expect(withoutCover.status).toBe(201);
    expect(withoutCover.body.hasCover).toBe(false);
    const missing = await request(app.getHttpServer()).get(`/api/auctions/${withoutCover.body.id}/cover`);
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('COVER_NOT_FOUND');
    expect(await prisma.auction.count()).toBe(2);
  });

  it('classifies live, scheduled and ended lots and rejects an invalid window', async () => {
    const seller = await register(Role.SELLER, 'helena@example.com');
    const live = await request(app.getHttpServer())
      .post('/api/auctions')
      .set(auth(seller.accessToken))
      .send(createBody());
    const moving = await request(app.getHttpServer())
      .post('/api/auctions')
      .set(auth(seller.accessToken))
      .send(createBody());
    const scheduled = await request(app.getHttpServer())
      .post('/api/auctions')
      .set(auth(seller.accessToken))
      .send(
        createBody({
          startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
          endsAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
        }),
      );
    expect(live.body.displayStatus).toBe('live');
    expect(scheduled.body.displayStatus).toBe('scheduled');
    expect(await anchor(live.body.id)).toBe('INTEGRO');
    expect(await anchor(scheduled.body.id)).toBe('INTEGRO');

    const endedId = moving.body.id;
    await prisma.$executeRaw`
      UPDATE "Auction"
      SET "startsAt" = clock_timestamp() - interval '2 hours',
          "endsAt" = clock_timestamp() - interval '1 minute'
      WHERE id = CAST(${endedId} AS uuid)
    `;

    const pastEnd = await request(app.getHttpServer())
      .post('/api/auctions')
      .set(auth(seller.accessToken))
      .send(
        createBody({
          startsAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
          endsAt: new Date(Date.now() - 10 * 60_000).toISOString(),
        }),
      );
    expect(pastEnd.status).toBe(422);
    expect(pastEnd.body.code).toBe('AUCTION_WINDOW_INVALID');

    const backwards = await request(app.getHttpServer())
      .post('/api/auctions')
      .set(auth(seller.accessToken))
      .send(
        createBody({
          startsAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
          endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        }),
      );
    expect(backwards.status).toBe(422);
    expect(backwards.body.code).toBe('AUCTION_WINDOW_INVALID');

    const cheap = await request(app.getHttpServer())
      .post('/api/auctions')
      .set(auth(seller.accessToken))
      .send(createBody({ startingBidCents: 0 }));
    expect(cheap.status).toBe(400);
    expect(cheap.body.code).toBe('VALIDATION_ERROR');

    const huge = await request(app.getHttpServer())
      .post('/api/auctions')
      .set(auth(seller.accessToken))
      .send(createBody({ minIncrementCents: MONEY_MAX_CENTS + 1 }));
    expect(huge.status).toBe(400);
    expect(huge.body.code).toBe('VALIDATION_ERROR');
    expect(await prisma.auction.count()).toBe(3);

    const token = auth(seller.accessToken);
    const liveList = await request(app.getHttpServer()).get('/api/auctions?status=live').set(token);
    const scheduledList = await request(app.getHttpServer())
      .get('/api/auctions?status=scheduled')
      .set(token);
    const endedList = await request(app.getHttpServer()).get('/api/auctions?status=ended').set(token);
    expect(liveList.body.map((auction: { id: string }) => auction.id)).toEqual([live.body.id]);
    expect(scheduledList.body.map((auction: { id: string }) => auction.id)).toEqual([scheduled.body.id]);
    expect(endedList.body.map((auction: { id: string }) => auction.id)).toEqual([endedId]);
  });

  it('lets a seller manage only their own lots', async () => {
    const owner = await register(Role.SELLER, 'helena@example.com');
    const other = await register(Role.SELLER, 'outro@example.com');
    const bidder = await register(Role.BIDDER, 'bruno@example.com');
    const created = await request(app.getHttpServer())
      .post('/api/auctions')
      .set(auth(owner.accessToken))
      .send(createBody());
    const before = await prisma.auction.findUniqueOrThrow({ where: { id: created.body.id } });

    const intruder = await request(app.getHttpServer())
      .post(`/api/auctions/${created.body.id}/cancel`)
      .set(auth(other.accessToken));
    expect(intruder.status).toBe(403);
    expect(intruder.body.code).toBe('FORBIDDEN');
    expect(intruder.body.message).toContain('próprios lotes');

    const bidderCancel = await request(app.getHttpServer())
      .post(`/api/auctions/${created.body.id}/cancel`)
      .set(auth(bidder.accessToken));
    expect(bidderCancel.status).toBe(403);
    expect(bidderCancel.body.code).toBe('FORBIDDEN');

    const anonymous = await request(app.getHttpServer()).get('/api/auctions?status=live');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.code).toBe('UNAUTHORIZED');

    const own = await request(app.getHttpServer()).get('/api/auctions/mine').set(auth(owner.accessToken));
    const theirs = await request(app.getHttpServer()).get('/api/auctions/mine').set(auth(other.accessToken));
    expect(own.body.map((auction: { id: string }) => auction.id)).toEqual([created.body.id]);
    expect(theirs.body).toEqual([]);

    const after = await prisma.auction.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(after.status).toBe(before.status);
    expect(after.auditStateMac).toBe(before.auditStateMac);
    expect(after.version).toBe(before.version);
  });

  it('refuses to cancel a lot with bids or a lot whose seller was swapped, and does not rewrite the anchor', async () => {
    const owner = await register(Role.SELLER, 'helena@example.com');
    const other = await register(Role.SELLER, 'outro@example.com');
    const bidder = await register(Role.BIDDER, 'bruno@example.com');
    const created = await request(app.getHttpServer())
      .post('/api/auctions')
      .set(auth(owner.accessToken))
      .send(createBody());
    const id = created.body.id;
    const before = await prisma.auction.findUniqueOrThrow({ where: { id } });

    await prisma.$executeRaw`
      UPDATE "Auction"
      SET "bidCount" = 1,
          "currentBidCents" = 1500,
          "currentLeaderId" = CAST(${bidder.user.id} AS uuid),
          "currentLeaderPublicId" = ${bidder.user.publicId}
      WHERE id = CAST(${id} AS uuid)
    `;
    const withBids = await request(app.getHttpServer())
      .post(`/api/auctions/${id}/cancel`)
      .set(auth(owner.accessToken));
    expect(withBids.status).toBe(422);
    expect(withBids.body.code).toBe('CANCEL_HAS_BIDS');
    const afterBids = await prisma.auction.findUniqueOrThrow({ where: { id } });
    expect(afterBids.status).toBe('OPEN');
    expect(afterBids.bidCount).toBe(1);
    expect(afterBids.version).toBe(before.version);
    expect(afterBids.auditStateMac).toBe(before.auditStateMac);

    await prisma.$executeRaw`
      UPDATE "Auction"
      SET "bidCount" = 0,
          "currentBidCents" = NULL,
          "currentLeaderId" = NULL,
          "currentLeaderPublicId" = NULL
      WHERE id = CAST(${id} AS uuid)
    `;
    await prisma.auction.update({
      where: { id },
      data: { seller: { connect: { id: other.user.id } } },
    });
    const launder = await request(app.getHttpServer())
      .post(`/api/auctions/${id}/cancel`)
      .set(auth(other.accessToken));
    expect(launder.status).toBe(422);
    expect(launder.body.code).toBe('AUCTION_INTEGRITY');

    const after = await prisma.auction.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe('OPEN');
    expect(after.sellerId).toBe(other.user.id);
    expect(after.version).toBe(before.version);
    expect(after.auditStateMac).toBe(before.auditStateMac);
    expect(after.auditHeadHash).toBe(before.auditHeadHash);
    expect(await anchor(id)).toBe('ADULTERADO');
  });

  it('follows the seller journey: create, show, forbid the bidder, and hide a cancelled lot', async () => {
    const seller = await register(Role.SELLER, 'helena@example.com');
    const bidder = await register(Role.BIDDER, 'bruno@example.com');
    const created = await request(app.getHttpServer())
      .post('/api/auctions')
      .set(auth(seller.accessToken))
      .send(createBody());
    expect(created.status).toBe(201);
    expect(created.body.displayStatus).toBe('live');
    const before = await prisma.auction.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(await anchor(before.id)).toBe('INTEGRO');

    const bidderToken = auth(bidder.accessToken);
    const live = await request(app.getHttpServer()).get('/api/auctions?status=live').set(bidderToken);
    const scheduled = await request(app.getHttpServer())
      .get('/api/auctions?status=scheduled')
      .set(bidderToken);
    const ended = await request(app.getHttpServer()).get('/api/auctions?status=ended').set(bidderToken);
    expect(live.body.map((auction: { id: string }) => auction.id)).toEqual([created.body.id]);
    expect(scheduled.body).toEqual([]);
    expect(ended.body).toEqual([]);

    const forbidden = await request(app.getHttpServer())
      .post('/api/auctions')
      .set(bidderToken)
      .send(createBody());
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');

    const cancelled = await request(app.getHttpServer())
      .post(`/api/auctions/${created.body.id}/cancel`)
      .set(auth(seller.accessToken));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.displayStatus).toBe('cancelled');
    expect(cancelled.body.status).toBe('CANCELLED');

    for (const status of ['live', 'scheduled', 'ended']) {
      const list = await request(app.getHttpServer())
        .get(`/api/auctions?status=${status}`)
        .set(bidderToken);
      expect(list.body).toEqual([]);
    }

    const mine = await request(app.getHttpServer()).get('/api/auctions/mine').set(auth(seller.accessToken));
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].id).toBe(created.body.id);
    expect(mine.body[0].displayStatus).toBe('cancelled');

    const after = await prisma.auction.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(after.version).toBe(1);
    expect(after.auditHeadHash).toBe(before.auditHeadHash);
    expect(after.auditStateMac).not.toBe(before.auditStateMac);
    expect(after.sellerId).toBe(before.sellerId);
    expect(after.sellerPublicId).toBe(before.sellerPublicId);
    expect(await anchor(after.id)).toBe('INTEGRO');
  });
});

async function register(role: Role, email: string) {
  const response = await request(appOf()).post('/api/auth/register').send({
    name: role === Role.SELLER ? 'Helena Vendedora' : 'Bruno Licitante',
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

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function anchor(id: string) {
  const row = await prisma.auction.findUniqueOrThrow({ where: { id } });
  const secret = process.env.AUDIT_HMAC_SECRET;
  if (!secret) {
    throw new Error('AUDIT_HMAC_SECRET is missing');
  }
  return verifyAuction(row, new Map([[AUDIT_KEY_VERSION, secret]]));
}

function readCover(path: string) {
  return request(appOf())
    .get(path)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

function appOf() {
  if (!httpApp) {
    throw new Error('App is not ready');
  }
  return httpApp.getHttpServer();
}
