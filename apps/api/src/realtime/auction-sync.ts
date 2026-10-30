export const ROOM_REFRESH_MS = 20_000;

export type RoomBid = {
  sequence: number;
  bidderPublicId: string;
  amountCents: number;
  endsAtAfter: string;
  createdAt: string;
};

export type RoomAuction = {
  id: string;
  status: 'OPEN' | 'CANCELLED' | 'SETTLED' | 'UNSOLD';
  displayStatus: 'live' | 'scheduled' | 'ended' | 'cancelled';
  currentBidCents: number | null;
  currentLeaderPublicId: string | null;
  bidCount: number;
  version: number;
  startsAt: string;
  originalEndsAt: string;
  endsAt: string;
};

export type AuctionUpdatedEvent = {
  id: string;
  version: number;
  status: RoomAuction['status'];
  currentBidCents: number | null;
  bidCount: number;
  currentLeaderPublicId: string | null;
  startsAt: string;
  originalEndsAt: string;
  endsAt: string;
  serverNow: string;
  bid?: RoomBid;
};

export type RoomState<T extends RoomAuction> = {
  auction: T;
  bids: RoomBid[];
  serverNow: string;
};

export type SnapshotOutcome = {
  applied: boolean;
  followUp: 'none' | 'refetch';
};

export type Standing = 'visitor' | 'seller' | 'leading' | 'outbid' | 'watching';

/**
 * Version is the only ordering key. A socket event applies only when it is the
 * next version; a REST snapshot applies only when it is newer than local state.
 * The first snapshot applies because there is no local version yet.
 */
export class RoomSync<T extends RoomAuction> {
  private state: RoomState<T> | null = null;
  private pending: AuctionUpdatedEvent | null = null;

  get current() {
    return this.state;
  }

  noteEvent(event: AuctionUpdatedEvent): 'pending' | 'ignore' | 'refetch' | 'apply' {
    if (!this.state) {
      if (!this.pending || event.version > this.pending.version) {
        this.pending = event;
      }
      return 'pending';
    }
    return this.applyEvent(event);
  }

  noteSnapshot(auction: T, bids: RoomBid[], serverNow: string): SnapshotOutcome {
    if (this.state && auction.version <= this.state.auction.version) {
      return { applied: false, followUp: 'none' };
    }
    if (bids.length !== auction.bidCount) {
      return { applied: false, followUp: 'refetch' };
    }
    this.state = {
      auction: { ...auction, displayStatus: displayOf(auction, serverNow) },
      bids,
      serverNow,
    };
    return this.foldPending();
  }

  private foldPending(): SnapshotOutcome {
    if (!this.pending || !this.state) {
      return { applied: true, followUp: 'none' };
    }
    const pending = this.pending;
    this.pending = null;
    const follow = this.applyEvent(pending);
    if (follow === 'refetch') {
      this.pending = pending;
      return { applied: true, followUp: 'refetch' };
    }
    return { applied: true, followUp: 'none' };
  }

  private applyEvent(event: AuctionUpdatedEvent): 'ignore' | 'refetch' | 'apply' {
    if (!this.state || event.id !== this.state.auction.id) {
      return 'ignore';
    }
    if (event.version <= this.state.auction.version) {
      return 'ignore';
    }
    if (event.version > this.state.auction.version + 1) {
      return 'refetch';
    }

    const current = this.state;
    let bids = current.bids;
    if (event.bidCount === current.auction.bidCount + 1) {
      const alreadyThere = bids.some((bid) => bid.sequence === event.bidCount);
      if (!alreadyThere) {
        if (!event.bid || event.bid.sequence !== event.bidCount) {
          return 'refetch';
        }
        bids = [...bids, event.bid];
      }
    } else if (event.bidCount !== current.auction.bidCount) {
      return 'refetch';
    }

    this.state = {
      auction: {
        ...current.auction,
        version: event.version,
        status: event.status,
        currentBidCents: event.currentBidCents,
        bidCount: event.bidCount,
        currentLeaderPublicId: event.currentLeaderPublicId,
        startsAt: event.startsAt,
        originalEndsAt: event.originalEndsAt,
        endsAt: event.endsAt,
        displayStatus: displayOf(event, event.serverNow),
      },
      bids,
      serverNow: event.serverNow,
    };
    return 'apply';
  }
}

export async function refreshRoom<T extends RoomAuction>(
  sync: RoomSync<T>,
  load: () => Promise<{ auction: T; bids: RoomBid[]; serverNow: string }>,
): Promise<SnapshotOutcome> {
  let outcome: SnapshotOutcome = { applied: false, followUp: 'none' };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await load();
    outcome = sync.noteSnapshot(snapshot.auction, snapshot.bids, snapshot.serverNow);
    if (outcome.followUp !== 'refetch') {
      return outcome;
    }
  }
  return outcome;
}

export function bidStanding(
  viewer: { publicId: string; role: 'SELLER' | 'BIDDER' } | null,
  auction: Pick<RoomAuction, 'currentLeaderPublicId'>,
  bids: Array<Pick<RoomBid, 'bidderPublicId'>>,
): Standing {
  if (!viewer) {
    return 'visitor';
  }
  if (viewer.role !== 'BIDDER') {
    return 'seller';
  }
  if (auction.currentLeaderPublicId === viewer.publicId) {
    return 'leading';
  }
  if (bids.some((bid) => bid.bidderPublicId === viewer.publicId)) {
    return 'outbid';
  }
  return 'watching';
}

function displayOf(
  auction: { status: RoomAuction['status']; startsAt: string; endsAt: string },
  serverNow: string,
): RoomAuction['displayStatus'] {
  if (auction.status === 'CANCELLED') {
    return 'cancelled';
  }
  const now = Date.parse(serverNow);
  if (Date.parse(auction.endsAt) <= now) {
    return 'ended';
  }
  if (Date.parse(auction.startsAt) > now) {
    return 'scheduled';
  }
  return 'live';
}
