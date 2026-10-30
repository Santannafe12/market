import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MONEY_MAX_CENTS } from '../src/common/money';
import { configureApp } from '../src/configure-app';
import { validateEnv } from '../src/config/env';

const { assertTestDatabaseUrl } = require('./assert-test-database') as {
  assertTestDatabaseUrl: (connectionString: string | undefined) => { name: string };
};

const prisma = new PrismaClient();

describe('Auth HTTP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, validateEnv(process.env));
    await app.init();
  });

  beforeEach(async () => {
    assertTestDatabaseUrl(process.env.DATABASE_URL);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Wallet", "User" CASCADE');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('registers both roles with a public id and an empty wallet', async () => {
    const seller = await request(app.getHttpServer()).post('/api/auth/register').send({
      name: 'Leiloeiro Demo',
      email: 'seller@example.com',
      password: 'senha-segura',
      role: Role.SELLER,
    });

    expect(seller.status).toBe(201);
    expect(seller.body.user.role).toBe('SELLER');
    expect(seller.body.user.publicId).toEqual(expect.any(String));
    expect(seller.body.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(seller.body)).not.toContain('senha-segura');
    expect(JSON.stringify(seller.body)).not.toContain('$2');

    const bidder = await request(app.getHttpServer()).post('/api/auth/register').send({
      name: 'Licitante Demo',
      email: 'bidder@example.com',
      password: 'senha-segura',
      role: Role.BIDDER,
    });

    expect(bidder.status).toBe(201);
    expect(bidder.body.user.role).toBe('BIDDER');
    expect(bidder.body.user.publicId).not.toBe(seller.body.user.publicId);

    const wallets = await prisma.wallet.findMany();
    expect(wallets).toHaveLength(2);
    expect(wallets.every((wallet) => wallet.balanceCents === 0)).toBe(true);
  });

  it('rejects a duplicate email without creating a second wallet', async () => {
    const payload = {
      name: 'Ana',
      email: 'ana@example.com',
      password: 'senha-segura',
      role: Role.BIDDER,
    };

    await request(app.getHttpServer()).post('/api/auth/register').send(payload).expect(201);

    const duplicate = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ ...payload, email: 'Ana@example.com', name: 'Outra Ana' });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.wallet.count()).toBe(1);
  });

  it('rejects a wrong password and an anonymous session', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send({
      name: 'Ana',
      email: 'ana@example.com',
      password: 'senha-segura',
      role: Role.BIDDER,
    });

    const login = await request(app.getHttpServer()).post('/api/auth/login').send({
      email: 'ana@example.com',
      password: 'senha-errada',
    });

    expect(login.status).toBe(401);
    expect(login.body.code).toBe('INVALID_CREDENTIALS');

    const me = await request(app.getHttpServer()).get('/api/auth/me');
    expect(me.status).toBe(401);
    expect(me.body.code).toBe('UNAUTHORIZED');
  });

  it('rejects an unknown field', async () => {
    const response = await request(app.getHttpServer()).post('/api/auth/login').send({
      email: 'ana@example.com',
      password: 'senha-segura',
      extra: 'nope',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns the signed-in user and keeps the wallet balance at zero', async () => {
    const registered = await request(app.getHttpServer()).post('/api/auth/register').send({
      name: 'Bruno',
      email: 'bruno@example.com',
      password: 'senha-segura',
      role: Role.BIDDER,
    });

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${registered.body.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      email: 'bruno@example.com',
      role: 'BIDDER',
      publicId: registered.body.user.publicId,
    });
    expect(me.body.passwordHash).toBeUndefined();

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: registered.body.user.id },
    });
    expect(wallet.balanceCents).toBe(0);
  });

  it('rejects a unicode password that stays under 72 characters and exceeds 72 bytes', async () => {
    const password = 'á'.repeat(37);
    expect(password.length).toBeLessThan(72);
    expect(Buffer.byteLength(password, 'utf8')).toBeGreaterThan(72);

    const response = await request(app.getHttpServer()).post('/api/auth/register').send({
      name: 'Ana',
      email: 'ana@example.com',
      password,
      role: Role.BIDDER,
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.message).toContain('72 bytes');
    expect(await prisma.user.count()).toBe(0);
  });

  it('accepts a password of exactly 72 bytes', async () => {
    const password = 'a'.repeat(72);
    expect(Buffer.byteLength(password, 'utf8')).toBe(72);

    const response = await request(app.getHttpServer()).post('/api/auth/register').send({
      name: 'Ana',
      email: 'ana@example.com',
      password,
      role: Role.BIDDER,
    });

    expect(response.status).toBe(201);
    expect(response.body.user.passwordHash).toBeUndefined();
  });

  it('rejects a name made only of spaces', async () => {
    const response = await request(app.getHttpServer()).post('/api/auth/register').send({
      name: '   ',
      email: 'ana@example.com',
      password: 'senha-segura',
      role: Role.BIDDER,
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.message).toContain('2 caracteres');
    expect(await prisma.user.count()).toBe(0);
  });

  it('keeps the wallet balance inside the integer cap', async () => {
    const registered = await request(app.getHttpServer()).post('/api/auth/register').send({
      name: 'Bruno',
      email: 'bruno@example.com',
      password: 'senha-segura',
      role: Role.BIDDER,
    });

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: registered.body.user.id },
    });

    await expect(
      prisma.wallet.update({
        where: { id: wallet.id },
        data: { balanceCents: MONEY_MAX_CENTS + 1 },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.wallet.update({
        where: { id: wallet.id },
        data: { balanceCents: -1 },
      }),
    ).rejects.toThrow();

    const persisted = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(persisted.balanceCents).toBe(0);
  });
});
