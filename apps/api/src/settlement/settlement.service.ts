import { randomBytes, randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuditVerdict, auditIdentities } from '../audit/audit';
import { auctionViewSelect, toPublicAuction, type AuctionView } from '../auctions/auction.presenter';
import { DomainError } from '../common/domain-error';
import { DomainEvents } from '../common/domain-events';
import { MONEY_MAX_CENTS } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { databaseNow, lockAuction, lockWallet } from '../wallet/wallet.sql';

const TX_LOCK_TIMEOUT = '25s';
/** One page per cycle. A process-local cursor walks past lots that stay open. */
export const DUE_SCAN_LIMIT = 20;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export type FinalizeOutcome =
  | { outcome: 'SETTLED' }
  | { outcome: 'UNSOLD' }
  | { outcome: 'ALREADY_FINAL' }
  | { outcome: 'NOT_DUE' }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INTEGRITY'; verdict: AuditVerdict };

export type MarkEndedOutcome = { outcome: 'ENDED' | 'UNCHANGED' | 'INTEGRITY' | 'NOT_FOUND' };

type LockedWallet = { id: string; balanceCents: number };

type FinalizeWork =
  | { outcome: 'SETTLED'; walletUserIds: string[] }
  | { outcome: 'UNSOLD' }
  | { outcome: 'ALREADY_FINAL' }
  | { outcome: 'NOT_DUE' }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INTEGRITY'; verdict: AuditVerdict };

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);
  /** Next due page. Not stored in the database; a restart retries from the oldest row. */
  private dueCursor: { endsAt: Date; id: string } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  /**
   * Lists one page of due ids and releases the connection before finalizing.
   * The page is the next `(endsAt, id)` after the previous cycle. Lots that stay
   * open are skipped until the cursor wraps, so a stuck page cannot hide later lots.
   * Each id opens its own transaction. A repeated id is safe because of that lock.
   */
  async finalizeDueAuctions() {
    if (this.dueCursor) {
      const anchor = await this.prisma.auction.findUnique({
        where: { id: this.dueCursor.id },
        select: { id: true },
      });
      if (!anchor) {
        this.dueCursor = null;
      }
    }
    const cursor = this.dueCursor;
    const due = await this.prisma.$queryRaw<Array<{ id: string; endsAt: Date }>>(
      cursor
        ? Prisma.sql`
            SELECT id, "endsAt"
            FROM "Auction"
            WHERE status = 'OPEN'::"AuctionStatus"
              AND "endsAt" <= clock_timestamp()
              AND ("endsAt", id) > (${cursor.endsAt}, CAST(${cursor.id} AS uuid))
            ORDER BY "endsAt" ASC, id ASC
            LIMIT ${DUE_SCAN_LIMIT}
          `
        : Prisma.sql`
            SELECT id, "endsAt"
            FROM "Auction"
            WHERE status = 'OPEN'::"AuctionStatus"
              AND "endsAt" <= clock_timestamp()
            ORDER BY "endsAt" ASC, id ASC
            LIMIT ${DUE_SCAN_LIMIT}
          `,
    );
    if (due.length === 0) {
      this.dueCursor = null;
      return [];
    }
    const outcomes: FinalizeOutcome[] = [];
    for (const row of due) {
      try {
        outcomes.push(await this.finalizeAuction(row.id));
      } catch (error) {
        if (error instanceof DomainError) {
          this.logger.error(`Falha ao liquidar um lote vencido: ${error.code}`);
        } else {
          this.logger.error('Falha ao liquidar um lote vencido.');
        }
      }
    }
    const last = due[due.length - 1];
    const endsAt = last.endsAt instanceof Date ? last.endsAt : new Date(last.endsAt);
    this.dueCursor = due.length < DUE_SCAN_LIMIT ? null : { endsAt, id: last.id };
    return outcomes;
  }

  /** `receiptToken` is only passed by the seed, so the historical demo receipt keeps a known link. */
  async finalizeAuction(id: string, receiptToken?: string): Promise<FinalizeOutcome> {
    if (!UUID_PATTERN.test(id)) {
      return { outcome: 'NOT_FOUND' };
    }
    if (receiptToken !== undefined && !TOKEN_PATTERN.test(receiptToken)) {
      throw new DomainError('VALIDATION_ERROR', 400, 'Token de comprovante inválido.');
    }
    const work = await this.prisma.$transaction((tx) => this.finalizeOnce(tx, id, receiptToken), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 30_000,
    });
    if (work.outcome === 'INTEGRITY') {
      this.logger.warn(`Liquidação recusada por integridade: veredito ${work.verdict}`);
      return { outcome: 'INTEGRITY', verdict: work.verdict };
    }
    if (work.outcome === 'SETTLED') {
      this.publish(id, work.walletUserIds);
      return { outcome: 'SETTLED' };
    }
    if (work.outcome === 'UNSOLD') {
      this.publish(id, []);
      return { outcome: 'UNSOLD' };
    }
    return { outcome: work.outcome };
  }

  /** Test and seed hook. Moves a sound open lot into the past and resigns only that state. */
  async markEnded(id: string): Promise<MarkEndedOutcome> {
    if (!UUID_PATTERN.test(id)) {
      return { outcome: 'NOT_FOUND' };
    }
    return this.prisma.$transaction((tx) => this.markEndedOnce(tx, id), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 30_000,
    });
  }

  async receipt(publicToken: string) {
    if (!TOKEN_PATTERN.test(publicToken)) {
      throw new DomainError('RECEIPT_NOT_FOUND', 404, 'Comprovante não encontrado.');
    }
    const row = await this.prisma.receipt.findUnique({ where: { publicToken } });
    if (!row) {
      throw new DomainError('RECEIPT_NOT_FOUND', 404, 'Comprovante não encontrado.');
    }
    return {
      publicToken: row.publicToken,
      auctionId: row.auctionId,
      title: row.title,
      amountCents: row.amountCents,
      winnerPublicId: row.winnerPublicId,
      sellerPublicId: row.sellerPublicId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async participations(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, publicId: true },
    });
    if (!user) {
      throw new DomainError('UNAUTHORIZED', 401, 'Sessão inválida.');
    }
    const grouped = await this.prisma.bid.groupBy({
      by: ['auctionId'],
      where: { bidderId: userId },
    });
    if (grouped.length === 0) {
      return [];
    }
    const now = await databaseNow(this.prisma);
    const auctions = await this.prisma.auction.findMany({
      where: { id: { in: grouped.map((row) => row.auctionId) } },
      orderBy: [{ endsAt: 'desc' }, { createdAt: 'desc' }],
      select: auctionViewSelect,
    });
    const receipts = await this.prisma.receipt.findMany({
      where: {
        auctionId: { in: auctions.map((auction) => auction.id) },
        winnerPublicId: user.publicId,
      },
      select: { auctionId: true, publicToken: true },
    });
    const tokenByAuction = new Map(receipts.map((receipt) => [receipt.auctionId, receipt.publicToken]));
    return auctions.map((auction) => {
      const result = participationResult(auction, user.id);
      return {
        result,
        receiptToken: result === 'WON' ? (tokenByAuction.get(auction.id) ?? null) : null,
        auction: toPublicAuction(auction, now),
      };
    });
  }

  async receivedBySeller(sellerId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ total: string }>>(Prisma.sql`
      SELECT COALESCE(SUM(l."amountCents"), 0)::text AS total
      FROM "WalletLedger" l
      INNER JOIN "Wallet" w ON w.id = l."walletId"
      WHERE w."userId" = CAST(${sellerId} AS uuid)
        AND l."type" = 'SETTLEMENT_CREDIT'::"WalletEntryType"
    `);
    const total = Number(rows[0]?.total ?? '0');
    if (!Number.isSafeInteger(total) || total < 0 || total > MONEY_MAX_CENTS) {
      throw new DomainError('AMOUNT_OVERFLOW', 422, 'Esse valor passa do limite permitido.');
    }
    return { receivedCents: total };
  }

  private async finalizeOnce(
    tx: Prisma.TransactionClient,
    id: string,
    receiptToken: string | undefined,
  ): Promise<FinalizeWork> {
    await tx.$queryRaw(Prisma.sql`SELECT set_config('lock_timeout', ${TX_LOCK_TIMEOUT}, true)`);
    if (!(await lockAuction(tx, id))) {
      return { outcome: 'NOT_FOUND' };
    }
    const auction = await tx.auction.findUniqueOrThrow({ where: { id }, select: auctionViewSelect });
    if (auction.status !== 'OPEN') {
      return { outcome: 'ALREADY_FINAL' };
    }
    const now = await databaseNow(tx);
    if (auction.endsAt.getTime() > now.getTime()) {
      return { outcome: 'NOT_DUE' };
    }

    const bids = await tx.bid.findMany({ where: { auctionId: id }, orderBy: { sequence: 'asc' } });
    const verdict = await this.verdict(tx, auction, bids);
    if (verdict !== 'INTEGRO') {
      return { outcome: 'INTEGRITY', verdict };
    }

    if (bids.length === 0) {
      await this.writeState(tx, auction, { status: 'UNSOLD' });
      return { outcome: 'UNSOLD' };
    }

    const winnerId = auction.currentLeaderId;
    const amount = auction.currentBidCents;
    const winnerPublicId = auction.currentLeaderPublicId;
    if (!winnerId || winnerPublicId === null || amount === null) {
      return { outcome: 'INTEGRITY', verdict: 'ADULTERADO' };
    }

    const wallets = await lockWalletsInOrder(tx, [winnerId, auction.sellerId]);
    const winner = wallets.get(winnerId);
    const seller = wallets.get(auction.sellerId);
    if (!winner || !seller) {
      throw new DomainError('WALLET_NOT_FOUND', 404, 'Carteira não encontrada.');
    }
    const sellerNext = seller.balanceCents + amount;
    if (sellerNext > MONEY_MAX_CENTS) {
      throw new DomainError('AMOUNT_OVERFLOW', 422, 'Esse valor passa do limite permitido.');
    }
    const winnerNext = winner.balanceCents - amount;
    if (winnerNext < 0) {
      throw new DomainError(
        'INSUFFICIENT_AVAILABLE_BALANCE',
        422,
        'Saldo insuficiente para liquidar o arremate.',
      );
    }

    await tx.wallet.update({ where: { id: winner.id }, data: { balanceCents: winnerNext } });
    await tx.walletLedger.create({
      data: {
        id: randomUUID(),
        walletId: winner.id,
        type: 'SETTLEMENT_DEBIT',
        amountCents: amount,
        balanceAfterCents: winnerNext,
        auctionId: auction.id,
      },
    });
    await tx.wallet.update({ where: { id: seller.id }, data: { balanceCents: sellerNext } });
    await tx.walletLedger.create({
      data: {
        id: randomUUID(),
        walletId: seller.id,
        type: 'SETTLEMENT_CREDIT',
        amountCents: amount,
        balanceAfterCents: sellerNext,
        auctionId: auction.id,
      },
    });
    await tx.receipt.create({
      data: {
        id: randomUUID(),
        publicToken: receiptToken ?? randomBytes(18).toString('base64url'),
        auctionId: auction.id,
        winnerPublicId,
        sellerPublicId: auction.sellerPublicId,
        amountCents: amount,
        title: auction.title,
      },
    });
    await this.writeState(tx, auction, { status: 'SETTLED' });
    return { outcome: 'SETTLED', walletUserIds: [winnerId, auction.sellerId] };
  }

  private async markEndedOnce(tx: Prisma.TransactionClient, id: string): Promise<MarkEndedOutcome> {
    await tx.$queryRaw(Prisma.sql`SELECT set_config('lock_timeout', ${TX_LOCK_TIMEOUT}, true)`);
    if (!(await lockAuction(tx, id))) {
      return { outcome: 'NOT_FOUND' };
    }
    const auction = await tx.auction.findUniqueOrThrow({ where: { id }, select: auctionViewSelect });
    if (auction.status !== 'OPEN') {
      return { outcome: 'UNCHANGED' };
    }
    const bids = await tx.bid.findMany({ where: { auctionId: id }, orderBy: { sequence: 'asc' } });
    if ((await this.verdict(tx, auction, bids)) !== 'INTEGRO') {
      return { outcome: 'INTEGRITY' };
    }
    const now = await databaseNow(tx);
    if (auction.endsAt.getTime() <= now.getTime()) {
      return { outcome: 'ENDED' };
    }
    const endsAt = new Date(now.getTime() - 1);
    await this.writeState(tx, auction, { endsAt });
    return { outcome: 'ENDED' };
  }

  private async verdict(
    tx: Prisma.TransactionClient,
    auction: AuctionView,
    bids: ReadonlyArray<{
      bidderId: string;
      auctionId: string;
      sequence: number;
      bidderPublicId: string;
      amountCents: number;
      previousHash: string;
      hash: string;
      endsAtAfter: Date;
      createdAt: Date;
    }>,
  ) {
    const referenced = new Set<string>([auction.sellerId, ...bids.map((bid) => bid.bidderId)]);
    if (auction.currentLeaderId) {
      referenced.add(auction.currentLeaderId);
    }
    const users = await tx.user.findMany({
      where: { id: { in: [...referenced] } },
      select: { id: true, publicId: true },
    });
    return this.audit.verify(auction, bids, auditIdentities(auction.sellerId, users));
  }

  private async writeState(
    tx: Prisma.TransactionClient,
    auction: AuctionView,
    patch: { status?: 'OPEN' | 'SETTLED' | 'UNSOLD'; endsAt?: Date },
  ) {
    const status = patch.status ?? auction.status;
    const endsAt = patch.endsAt ?? auction.endsAt;
    const version = auction.version + 1;
    const auditStateMac = this.audit.stateMac({
      version,
      auctionId: auction.id,
      status,
      sellerId: auction.sellerId,
      sellerPublicId: auction.sellerPublicId,
      bidCount: auction.bidCount,
      currentBidCents: auction.currentBidCents,
      currentLeaderId: auction.currentLeaderId,
      currentLeaderPublicId: auction.currentLeaderPublicId,
      startsAt: auction.startsAt,
      originalEndsAt: auction.originalEndsAt,
      endsAt,
      auditHeadHash: auction.auditHeadHash,
      keyVersion: auction.auditKeyVersion,
    });
    const updated = await tx.auction.updateMany({
      where: { id: auction.id, version: auction.version, status: 'OPEN' },
      data: {
        status,
        endsAt,
        version,
        auditStateMac,
      },
    });
    if (updated.count !== 1) {
      throw new DomainError('CONFLICT_RETRY_EXHAUSTED', 409, 'Não foi possível encerrar o lote. Tente de novo.');
    }
  }

  private publish(auctionId: string, walletUserIds: string[]) {
    try {
      this.events.auctionChanged(auctionId);
      for (const userId of walletUserIds) {
        this.events.walletHint(userId, auctionId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'erro desconhecido';
      this.logger.error(`Falha ao publicar evento de liquidação: ${message}`);
    }
  }
}

function participationResult(auction: Pick<AuctionView, 'status' | 'currentLeaderId'>, userId: string) {
  if (auction.status === 'CANCELLED') {
    return 'CANCELLED' as const;
  }
  if (auction.status === 'SETTLED') {
    return auction.currentLeaderId === userId ? ('WON' as const) : ('LOST' as const);
  }
  if (auction.status === 'UNSOLD') {
    return 'LOST' as const;
  }
  return auction.currentLeaderId === userId ? ('LEADING' as const) : ('OUTBID' as const);
}

/** Lot lock is already held. Wallets follow in userId order so two settlements cannot deadlock. */
async function lockWalletsInOrder(tx: Prisma.TransactionClient, userIds: string[]) {
  const ordered = [...new Set(userIds)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const locked = new Map<string, LockedWallet>();
  for (const userId of ordered) {
    const wallet = await lockWallet(tx, userId);
    if (!wallet) {
      throw new DomainError('WALLET_NOT_FOUND', 404, 'Carteira não encontrada.');
    }
    locked.set(userId, wallet);
  }
  return locked;
}
