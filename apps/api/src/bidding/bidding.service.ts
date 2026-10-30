import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { auctionViewSelect, toPublicAuction } from '../auctions/auction.presenter';
import { DomainError } from '../common/domain-error';
import { DomainEvents } from '../common/domain-events';
import { MONEY_MAX_CENTS } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { committedCents, databaseNow, lockAuction, lockWallet } from '../wallet/wallet.sql';

const ANTI_SNIPE_MS = 120_000;
const TX_LOCK_TIMEOUT = '25s';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class BiddingService {
  private readonly logger = new Logger(BiddingService.name);

  /** Test hook: throws inside the open transaction so the extension rolls back with the bid. */
  failBeforeCommit = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async list(auctionId: string) {
    if (!UUID_PATTERN.test(auctionId)) {
      throw new DomainError('AUCTION_NOT_FOUND', 404, 'Lote não encontrado.');
    }
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      select: { id: true },
    });
    if (!auction) {
      throw new DomainError('AUCTION_NOT_FOUND', 404, 'Lote não encontrado.');
    }
    const bids = await this.prisma.bid.findMany({
      where: { auctionId },
      orderBy: { sequence: 'asc' },
      select: {
        sequence: true,
        bidderPublicId: true,
        amountCents: true,
        endsAtAfter: true,
        createdAt: true,
      },
    });
    return bids.map(toPublicBid);
  }

  async placeBid(userId: string, auctionId: string, amountCents: number) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const outcome = await this.prisma.$transaction((tx) => this.placeOnce(tx, userId, auctionId, amountCents), {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 5_000,
          timeout: 30_000,
        });
        this.publish(outcome.auctionId, outcome.walletUserIds);
        return outcome.body;
      } catch (error) {
        if (!isRetryable(error) || attempt === 3) {
          if (isRetryable(error)) {
            throw new DomainError(
              'CONFLICT_RETRY_EXHAUSTED',
              409,
              'Não foi possível registrar o lance. Tente de novo.',
            );
          }
          throw error;
        }
      }
    }
    throw new DomainError('CONFLICT_RETRY_EXHAUSTED', 409, 'Não foi possível registrar o lance. Tente de novo.');
  }

  private async placeOnce(tx: Prisma.TransactionClient, userId: string, auctionId: string, amountCents: number) {
    await tx.$queryRaw(Prisma.sql`SELECT set_config('lock_timeout', ${TX_LOCK_TIMEOUT}, true)`);
    if (!UUID_PATTERN.test(auctionId)) {
      throw new DomainError('AUCTION_NOT_FOUND', 404, 'Lote não encontrado.');
    }
    if (!(await lockAuction(tx, auctionId))) {
      throw new DomainError('AUCTION_NOT_FOUND', 404, 'Lote não encontrado.');
    }

    const auction = await tx.auction.findUniqueOrThrow({
      where: { id: auctionId },
      select: auctionViewSelect,
    });
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, publicId: true, role: true },
    });
    if (!user) {
      throw new DomainError('UNAUTHORIZED', 401, 'Sessão inválida.');
    }
    if (auction.status !== 'OPEN') {
      throw new DomainError('AUCTION_CANCELLED', 422, 'Este lote foi cancelado.');
    }
    if (user.role === Role.SELLER || user.id === auction.sellerId) {
      throw new DomainError('SELLER_CANNOT_BID', 403, 'O leiloeiro não pode dar lances.');
    }
    if (user.role !== Role.BIDDER) {
      throw new DomainError('NOT_A_BIDDER', 403, 'Somente licitantes podem dar lances.');
    }
    if (auction.currentLeaderId === user.id) {
      throw new DomainError(
        'BID_LEADER_CANNOT_RAISE',
        422,
        'Você já está ganhando este lote e não pode cobrir o próprio lance.',
      );
    }

    const preview = await databaseNow(tx);
    const early = windowError(preview, auction);
    if (early) {
      throw early;
    }

    const wallet = await lockWallet(tx, user.id);
    if (!wallet) {
      throw new DomainError('WALLET_NOT_FOUND', 404, 'Carteira não encontrada.');
    }
    const committed = await committedCents(tx, user.id);
    const now = await databaseNow(tx);
    const closed = windowError(now, auction);
    if (closed) {
      throw closed;
    }

    if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
      throw new DomainError('AMOUNT_INVALID', 422, 'Informe um valor inteiro de pelo menos 1 centavo.');
    }
    if (amountCents > MONEY_MAX_CENTS) {
      throw new DomainError('AMOUNT_OVERFLOW', 422, 'Esse valor passa do limite permitido.');
    }
    if (auction.currentBidCents === null) {
      if (amountCents < auction.startingBidCents) {
        throw new DomainError(
          'BID_BELOW_STARTING',
          422,
          'O primeiro lance precisa ser pelo menos o lance inicial.',
        );
      }
    } else {
      const minimum = auction.currentBidCents + auction.minIncrementCents;
      if (minimum > MONEY_MAX_CENTS) {
        throw new DomainError('AMOUNT_OVERFLOW', 422, 'Esse valor passa do limite permitido.');
      }
      if (amountCents < minimum) {
        throw new DomainError(
          'BID_BELOW_INCREMENT',
          422,
          'O lance precisa cobrir o lance atual mais o incremento mínimo.',
        );
      }
    }
    if (amountCents > wallet.balanceCents - committed) {
      throw new DomainError(
        'INSUFFICIENT_AVAILABLE_BALANCE',
        422,
        'Saldo disponível insuficiente para este lance.',
      );
    }

    const history = await tx.bid.findMany({
      where: { auctionId: auction.id },
      orderBy: { sequence: 'asc' },
    });
    if (this.audit.verify(auction, history) !== 'INTEGRO') {
      throw new DomainError(
        'AUCTION_INTEGRITY',
        422,
        'A integridade do lote não confere. A operação foi recusada.',
      );
    }

    const endsAtAfter =
      auction.endsAt.getTime() - now.getTime() <= ANTI_SNIPE_MS
        ? new Date(auction.endsAt.getTime() + ANTI_SNIPE_MS)
        : auction.endsAt;
    const sequence = auction.bidCount + 1;
    const canonical = {
      auctionId: auction.id,
      sequence,
      bidderId: user.id,
      bidderPublicId: user.publicId,
      amountCents,
      previousHash: auction.auditHeadHash,
      endsAtAfter,
      createdAt: now,
    };
    const hash = this.audit.bidHash(canonical);
    const version = auction.version + 1;
    const auditStateMac = this.audit.stateMac({
      version,
      auctionId: auction.id,
      status: auction.status,
      sellerId: auction.sellerId,
      sellerPublicId: auction.sellerPublicId,
      bidCount: sequence,
      currentBidCents: amountCents,
      currentLeaderId: user.id,
      currentLeaderPublicId: user.publicId,
      startsAt: auction.startsAt,
      originalEndsAt: auction.originalEndsAt,
      endsAt: endsAtAfter,
      auditHeadHash: hash,
      keyVersion: auction.auditKeyVersion,
    });

    await tx.bid.create({
      data: {
        id: randomUUID(),
        ...canonical,
        hash,
      },
    });
    const updated = await tx.auction.updateMany({
      where: { id: auction.id, version: auction.version, status: 'OPEN' },
      data: {
        currentBidCents: amountCents,
        currentLeaderId: user.id,
        currentLeaderPublicId: user.publicId,
        bidCount: sequence,
        endsAt: endsAtAfter,
        version,
        auditHeadHash: hash,
        auditStateMac,
      },
    });
    if (updated.count !== 1) {
      throw new VersionConflict();
    }
    if (this.failBeforeCommit) {
      throw new Error('forced rollback');
    }

    const saved = await tx.auction.findUniqueOrThrow({
      where: { id: auction.id },
      select: auctionViewSelect,
    });
    const committedAfter = await committedCents(tx, user.id);
    const walletUserIds = [user.id];
    if (auction.currentLeaderId && auction.currentLeaderId !== user.id) {
      walletUserIds.push(auction.currentLeaderId);
    }
    return {
      auctionId: auction.id,
      walletUserIds,
      body: {
        auction: toPublicAuction(saved, now),
        bid: toPublicBid(canonical),
        wallet: {
          balanceCents: wallet.balanceCents,
          committedCents: committedAfter,
          availableCents: wallet.balanceCents - committedAfter,
        },
      },
    };
  }

  private publish(auctionId: string, walletUserIds: string[]) {
    try {
      this.events.auctionChanged(auctionId);
      for (const userId of walletUserIds) {
        this.events.walletHint(userId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'erro desconhecido';
      this.logger.error(`Falha ao publicar evento do lote ${auctionId}: ${message}`);
    }
  }
}

class VersionConflict extends Error {
  constructor() {
    super('version conflict');
  }
}

function windowError(now: Date, auction: { startsAt: Date; endsAt: Date }) {
  if (now.getTime() < auction.startsAt.getTime()) {
    return new DomainError('AUCTION_NOT_STARTED', 422, 'Este lote ainda não começou.');
  }
  if (now.getTime() >= auction.endsAt.getTime()) {
    return new DomainError('AUCTION_ENDED', 422, 'Este lote já encerrou.');
  }
  return null;
}

function isRetryable(error: unknown) {
  if (error instanceof VersionConflict) {
    return true;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2034') {
      return true;
    }
    const metaCode =
      error.meta && typeof error.meta === 'object' && 'code' in error.meta ? String(error.meta.code) : '';
    return metaCode === '40P01' || metaCode === '40001';
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { code: unknown }).code);
    return code === '40P01' || code === '40001';
  }
  return false;
}

function toPublicBid(bid: {
  sequence: number;
  bidderPublicId: string;
  amountCents: number;
  endsAtAfter: Date;
  createdAt: Date;
}) {
  return {
    sequence: bid.sequence,
    bidderPublicId: bid.bidderPublicId,
    amountCents: bid.amountCents,
    endsAtAfter: bid.endsAtAfter.toISOString(),
    createdAt: bid.createdAt.toISOString(),
  };
}
