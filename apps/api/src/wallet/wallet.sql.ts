import { Prisma, PrismaClient } from '@prisma/client';
import { DomainError } from '../common/domain-error';
import { MONEY_MAX_CENTS } from '../common/money';

type SqlClient = Prisma.TransactionClient | PrismaClient;

export async function databaseNow(db: SqlClient) {
  const rows = await db.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT date_trunc('milliseconds', clock_timestamp()) AS "now"`,
  );
  const now = new Date(rows[0]?.now);
  if (Number.isNaN(now.getTime())) {
    throw new DomainError('INTERNAL_ERROR', 500, 'Erro interno.');
  }
  return now;
}

export async function lockAuction(db: SqlClient, auctionId: string) {
  const rows = await db.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM "Auction" WHERE id = CAST(${auctionId} AS uuid) FOR UPDATE`,
  );
  return rows.length > 0;
}

export async function lockWallet(db: SqlClient, userId: string) {
  const rows = await db.$queryRaw<Array<{ id: string; balanceCents: number }>>(
    Prisma.sql`
      SELECT id, "balanceCents"
      FROM "Wallet"
      WHERE "userId" = CAST(${userId} AS uuid)
      FOR UPDATE
    `,
  );
  return rows[0] ?? null;
}

/**
 * Balance and committed sum from one statement, so both values share that statement's snapshot.
 * The committed sum stays derived and does not lock the other lots.
 */
export async function walletSnapshot(db: SqlClient, userId: string) {
  const rows = await db.$queryRaw<Array<{ balanceCents: number; committed: string }>>(
    Prisma.sql`
      SELECT
        w."balanceCents" AS "balanceCents",
        COALESCE((
          SELECT SUM(a."currentBidCents")
          FROM "Auction" a
          WHERE a."currentLeaderId" = w."userId"
            AND a."status" = 'OPEN'::"AuctionStatus"
        ), 0)::text AS "committed"
      FROM "Wallet" w
      WHERE w."userId" = CAST(${userId} AS uuid)
    `,
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { balanceCents: row.balanceCents, committedCents: parseCommitted(row.committed) };
}

/** Sum of open leaderships. Does not lock those lots: another bid already locks its own row first. */
export async function committedCents(db: SqlClient, userId: string) {
  const rows = await db.$queryRaw<Array<{ committed: string }>>(
    Prisma.sql`
      SELECT COALESCE(SUM("currentBidCents"), 0)::text AS "committed"
      FROM "Auction"
      WHERE "currentLeaderId" = CAST(${userId} AS uuid)
        AND "status" = 'OPEN'::"AuctionStatus"
    `,
  );
  return parseCommitted(rows[0]?.committed ?? '0');
}

function parseCommitted(value: string) {
  const committed = Number(value);
  if (!Number.isSafeInteger(committed) || committed < 0 || committed > MONEY_MAX_CENTS) {
    throw new DomainError('AMOUNT_OVERFLOW', 422, 'Esse valor passa do limite permitido.');
  }
  return committed;
}
