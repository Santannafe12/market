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
  const committed = Number(rows[0]?.committed ?? '0');
  if (!Number.isSafeInteger(committed) || committed < 0 || committed > MONEY_MAX_CENTS) {
    throw new DomainError('AMOUNT_OVERFLOW', 422, 'Esse valor passa do limite permitido.');
  }
  return committed;
}
