import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { auditIdentities } from '../audit/audit';
import { CatalogClient, CatalogRequestError, catalogHttpError } from '../catalog/catalog.client';
import { DomainError } from '../common/domain-error';
import { DomainEvents } from '../common/domain-events';
import { PrismaService } from '../prisma/prisma.service';
import { lockAuction } from '../wallet/wallet.sql';
import { auctionViewSelect, toPublicAuction } from './auction.presenter';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { ListAuctionsQueryDto } from './dto/list-auctions.dto';

const TX_LOCK_TIMEOUT = '25s';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class AuctionsService {
  private readonly logger = new Logger(AuctionsService.name);
  /**
   * Test seam. Runs inside the audit snapshot, after the lot is read and before
   * bids and identities. Production leaves it unset.
   */
  auditSnapshotGap: (() => Promise<void>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogClient,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async list(status: ListAuctionsQueryDto['status']) {
    const now = await this.databaseNow(this.prisma);
    const where: Prisma.AuctionWhereInput =
      status === 'live'
        ? { status: 'OPEN', startsAt: { lte: now }, endsAt: { gt: now } }
        : status === 'scheduled'
          ? { status: 'OPEN', startsAt: { gt: now } }
          : {
              OR: [
                { status: 'OPEN', endsAt: { lte: now } },
                { status: { in: ['SETTLED', 'UNSOLD'] } },
              ],
            };
    const rows = await this.prisma.auction.findMany({
      where,
      orderBy: status === 'ended' ? { endsAt: 'desc' } : status === 'scheduled' ? { startsAt: 'asc' } : { endsAt: 'asc' },
      select: auctionViewSelect,
    });
    return rows.map((row) => toPublicAuction(row, now));
  }

  async mine(sellerId: string) {
    const now = await this.databaseNow(this.prisma);
    const rows = await this.prisma.auction.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      select: auctionViewSelect,
    });
    return rows.map((row) => toPublicAuction(row, now));
  }

  async detail(id: string) {
    if (!isUuid(id)) {
      throw new DomainError('AUCTION_NOT_FOUND', 404, 'Lote não encontrado.');
    }
    const row = await this.prisma.auction.findUnique({ where: { id }, select: auctionViewSelect });
    if (!row) {
      throw new DomainError('AUCTION_NOT_FOUND', 404, 'Lote não encontrado.');
    }
    return toPublicAuction(row, await this.databaseNow(this.prisma));
  }

  async readAudit(id: string) {
    if (!isUuid(id)) {
      throw new DomainError('AUCTION_NOT_FOUND', 404, 'Lote não encontrado.');
    }
    const snapshot = await this.prisma.$transaction(
      async (tx) => {
        const row = await tx.auction.findUnique({ where: { id }, select: auctionViewSelect });
        if (!row) {
          return null;
        }
        if (this.auditSnapshotGap) {
          await this.auditSnapshotGap();
        }
        const bids = await tx.bid.findMany({
          where: { auctionId: id },
          orderBy: { sequence: 'asc' },
        });
        const referenced = new Set<string>([row.sellerId, ...bids.map((bid) => bid.bidderId)]);
        if (row.currentLeaderId) {
          referenced.add(row.currentLeaderId);
        }
        const users = await tx.user.findMany({
          where: { id: { in: [...referenced] } },
          select: { id: true, publicId: true },
        });
        const now = await this.databaseNow(tx);
        const report = this.audit.report(row, bids, auditIdentities(row.sellerId, users));
        return {
          verdict: report.verdict,
          failures: report.failures,
          auction: toPublicAuction(row, now),
          bids: bids.map(toAuditBid),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
    if (!snapshot) {
      throw new DomainError('AUCTION_NOT_FOUND', 404, 'Lote não encontrado.');
    }
    return snapshot;
  }

  async cover(id: string) {
    if (!isUuid(id)) {
      throw new DomainError('AUCTION_NOT_FOUND', 404, 'Lote não encontrado.');
    }
    const row = await this.prisma.auction.findUnique({
      where: { id },
      select: { coverImage: true, coverContentType: true },
    });
    if (!row) {
      throw new DomainError('AUCTION_NOT_FOUND', 404, 'Lote não encontrado.');
    }
    if (!row.coverImage || !row.coverContentType) {
      throw new DomainError('COVER_NOT_FOUND', 404, 'Este lote não tem capa.');
    }
    return { bytes: Buffer.from(row.coverImage), contentType: row.coverContentType };
  }

  async create(sellerId: string, input: CreateAuctionDto) {
    const snapshot = await this.snapshot(input.editionId);
    const startsAt = parseInstant(input.startsAt);
    const endsAt = parseInstant(input.endsAt);
    if (!startsAt || !endsAt) {
      throw new DomainError('VALIDATION_ERROR', 400, 'Informe início e fim válidos.');
    }

    return this.prisma.$transaction(async (tx) => {
      const now = await this.databaseNow(tx);
      if (endsAt.getTime() <= startsAt.getTime() || endsAt.getTime() <= now.getTime()) {
        throw new DomainError(
          'AUCTION_WINDOW_INVALID',
          422,
          'O fim do lote precisa ser posterior ao início e ao horário atual.',
        );
      }

      const seller = await tx.user.findUnique({
        where: { id: sellerId },
        select: { id: true, publicId: true, role: true },
      });
      if (!seller || seller.role !== Role.SELLER) {
        throw new DomainError('FORBIDDEN', 403, 'Você não tem permissão para esta operação.');
      }

      const id = randomUUID();
      const auditHeadHash = this.audit.genesisHash(id);
      const auditStateMac = this.audit.stateMac({
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
        keyVersion: this.audit.keyVersion,
      });

      const created = await tx.auction.create({
        data: {
          id,
          seller: { connect: { id: seller.id } },
          sellerPublicId: seller.publicId,
          status: 'OPEN',
          startingBidCents: input.startingBidCents,
          minIncrementCents: input.minIncrementCents,
          bidCount: 0,
          version: 0,
          startsAt,
          originalEndsAt: endsAt,
          endsAt,
          editionId: snapshot.edition.editionId,
          workId: snapshot.edition.workId,
          title: snapshot.edition.title,
          authors: snapshot.edition.authors,
          publisher: snapshot.edition.publisher,
          publishedDate: snapshot.edition.publishedDate,
          publishedYear: snapshot.edition.publishedYear,
          isbn: snapshot.edition.isbn,
          language: snapshot.edition.language,
          description: snapshot.edition.description,
          coverImage: snapshot.cover ? new Uint8Array(snapshot.cover.bytes) : null,
          coverContentType: snapshot.cover?.contentType ?? null,
          auditHeadHash,
          auditStateMac,
          auditKeyVersion: this.audit.keyVersion,
        },
        select: auctionViewSelect,
      });

      return toPublicAuction(created, now);
    });
  }

  async cancel(sellerId: string, id: string) {
    if (!isUuid(id)) {
      throw new DomainError('AUCTION_NOT_FOUND', 404, 'Lote não encontrado.');
    }

    const outcome = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT set_config('lock_timeout', ${TX_LOCK_TIMEOUT}, true)`);
        if (!(await lockAuction(tx, id))) {
          throw new DomainError('AUCTION_NOT_FOUND', 404, 'Lote não encontrado.');
        }

        const current = await tx.auction.findUniqueOrThrow({
          where: { id },
          select: auctionViewSelect,
        });
        if (current.sellerId !== sellerId) {
          throw new DomainError('FORBIDDEN', 403, 'Você só pode gerenciar os próprios lotes.');
        }
        if (current.status === 'SETTLED' || current.status === 'UNSOLD') {
          throw new DomainError(
            'ALREADY_FINAL',
            422,
            'Este lote já foi encerrado e não pode ser cancelado.',
          );
        }
        if (current.status !== 'OPEN') {
          throw new DomainError('AUCTION_NOT_OPEN', 422, 'Só é possível cancelar um lote aberto.');
        }

        const bids = await tx.bid.findMany({
          where: { auctionId: id },
          orderBy: { sequence: 'asc' },
        });
        const referenced = new Set<string>([current.sellerId, ...bids.map((bid) => bid.bidderId)]);
        if (current.currentLeaderId) {
          referenced.add(current.currentLeaderId);
        }
        const users = await tx.user.findMany({
          where: { id: { in: [...referenced] } },
          select: { id: true, publicId: true },
        });
        if (this.audit.verify(current, bids, auditIdentities(current.sellerId, users)) !== 'INTEGRO') {
          throw new DomainError(
            'AUCTION_INTEGRITY',
            422,
            'A integridade do lote não confere. A operação foi recusada.',
          );
        }

        const version = current.version + 1;
        const auditStateMac = this.audit.stateMac({
          version,
          auctionId: current.id,
          status: 'CANCELLED',
          sellerId: current.sellerId,
          sellerPublicId: current.sellerPublicId,
          bidCount: current.bidCount,
          currentBidCents: current.currentBidCents,
          currentLeaderId: current.currentLeaderId,
          currentLeaderPublicId: current.currentLeaderPublicId,
          startsAt: current.startsAt,
          originalEndsAt: current.originalEndsAt,
          endsAt: current.endsAt,
          auditHeadHash: current.auditHeadHash,
          keyVersion: current.auditKeyVersion,
        });
        const updated = await tx.auction.updateMany({
          where: { id: current.id, version: current.version, status: 'OPEN' },
          data: { status: 'CANCELLED', version, auditStateMac },
        });
        if (updated.count !== 1) {
          throw new DomainError(
            'CONFLICT_RETRY_EXHAUSTED',
            409,
            'Não foi possível cancelar o lote. Tente de novo.',
          );
        }

        const saved = await tx.auction.findUniqueOrThrow({ where: { id }, select: auctionViewSelect });
        return {
          auction: toPublicAuction(saved, await this.databaseNow(tx)),
          leaderId: current.currentLeaderId,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: 30_000,
      },
    );

    this.publish(id, outcome.leaderId ? [outcome.leaderId] : []);
    return outcome.auction;
  }

  private publish(auctionId: string, walletUserIds: string[]) {
    try {
      this.events.auctionChanged(auctionId);
      for (const userId of walletUserIds) {
        this.events.walletHint(userId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'erro desconhecido';
      this.logger.error(`Falha ao publicar evento de cancelamento: ${message}`);
    }
  }

  private async snapshot(editionId: string) {
    try {
      const edition = await this.catalog.edition(editionId);
      const cover = await this.catalog.downloadCover(edition.coverId);
      return { edition, cover };
    } catch (error) {
      if (error instanceof CatalogRequestError) {
        throw catalogHttpError(error);
      }
      throw error;
    }
  }

  private async databaseNow(db: Prisma.TransactionClient | PrismaService) {
    const rows = await db.$queryRaw<Array<{ now: Date }>>`
      SELECT date_trunc('milliseconds', clock_timestamp()) AS "now"
    `;
    const now = new Date(rows[0]?.now);
    if (Number.isNaN(now.getTime())) {
      throw new DomainError('INTERNAL_ERROR', 500, 'Erro interno.');
    }
    return now;
  }
}

function toAuditBid(bid: {
  sequence: number;
  bidderPublicId: string;
  amountCents: number;
  previousHash: string;
  hash: string;
  endsAtAfter: Date;
  createdAt: Date;
}) {
  return {
    sequence: bid.sequence,
    bidderPublicId: bid.bidderPublicId,
    amountCents: bid.amountCents,
    previousHash: bid.previousHash,
    hash: bid.hash,
    endsAtAfter: bid.endsAtAfter.toISOString(),
    createdAt: bid.createdAt.toISOString(),
  };
}

function parseInstant(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}
