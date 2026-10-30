import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import type { AuctionUpdatedEvent, RoomBid } from '../realtime/auction-sync';
import { auctionViewSelect } from '../auctions/auction.presenter';
import { databaseNow } from '../wallet/wallet.sql';

export function auctionRoom(auctionId: string) {
  return `auction:${auctionId}`;
}

export function userRoom(userId: string) {
  return `user:${userId}`;
}

/**
 * Called only after the financial transaction commits.
 * A delivery failure is logged and never rolled back.
 */
@Injectable()
export class DomainEvents {
  private readonly logger = new Logger(DomainEvents.name);
  private server: Server | null = null;

  /** Test hook. `sync` throws before delivery. `async` rejects inside delivery. */
  failEmit: false | 'sync' | 'async' = false;

  constructor(private readonly prisma: PrismaService) {}

  bind(server: Server) {
    this.server = server;
  }

  auctionChanged(auctionId: string, bid?: RoomBid) {
    if (this.failEmit === 'sync') {
      throw new Error('forced emit failure');
    }
    void this.deliverAuction(auctionId, bid).catch((error: unknown) => {
      this.logFailure('auction.updated', error);
    });
  }

  walletHint(userId: string, auctionId: string | null = null) {
    if (this.failEmit === 'sync') {
      throw new Error('forced emit failure');
    }
    if (!this.server) {
      return;
    }
    this.server.to(userRoom(userId)).emit('wallet.hint', {
      auctionId,
      reason: 'refresh',
    });
  }

  private async deliverAuction(auctionId: string, bid?: RoomBid) {
    if (this.failEmit === 'async') {
      throw new Error('forced async emit failure');
    }
    if (!this.server) {
      return;
    }
    const row = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      select: auctionViewSelect,
    });
    if (!row) {
      return;
    }
    const now = await databaseNow(this.prisma);
    const payload: AuctionUpdatedEvent = {
      id: row.id,
      version: row.version,
      status: row.status,
      currentBidCents: row.currentBidCents,
      bidCount: row.bidCount,
      currentLeaderPublicId: row.currentLeaderPublicId,
      startsAt: row.startsAt.toISOString(),
      originalEndsAt: row.originalEndsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      serverNow: now.toISOString(),
    };
    if (bid && bid.sequence === row.bidCount) {
      payload.bid = {
        sequence: bid.sequence,
        bidderPublicId: bid.bidderPublicId,
        amountCents: bid.amountCents,
        endsAtAfter: bid.endsAtAfter,
        createdAt: bid.createdAt,
      };
    }
    this.server.to(auctionRoom(row.id)).emit('auction.updated', payload);
  }

  private logFailure(scope: string, error: unknown) {
    const message = error instanceof Error ? error.message : 'erro desconhecido';
    this.logger.error(`Falha ao emitir ${scope}: ${message}`);
  }
}
