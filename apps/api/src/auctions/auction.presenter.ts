import { Prisma } from '@prisma/client';

export const auctionViewSelect = {
  id: true,
  sellerId: true,
  sellerPublicId: true,
  status: true,
  startingBidCents: true,
  minIncrementCents: true,
  currentBidCents: true,
  currentLeaderId: true,
  currentLeaderPublicId: true,
  bidCount: true,
  version: true,
  startsAt: true,
  originalEndsAt: true,
  endsAt: true,
  editionId: true,
  workId: true,
  title: true,
  authors: true,
  publisher: true,
  publishedDate: true,
  publishedYear: true,
  isbn: true,
  language: true,
  description: true,
  coverContentType: true,
  auditHeadHash: true,
  auditStateMac: true,
  auditKeyVersion: true,
  createdAt: true,
} satisfies Prisma.AuctionSelect;

export type AuctionView = Prisma.AuctionGetPayload<{ select: typeof auctionViewSelect }>;

export type DisplayStatus = 'live' | 'scheduled' | 'ended' | 'cancelled';

export function toPublicAuction(auction: AuctionView, now: Date) {
  return {
    id: auction.id,
    sellerPublicId: auction.sellerPublicId,
    status: auction.status,
    displayStatus: displayStatus(auction, now),
    startingBidCents: auction.startingBidCents,
    minIncrementCents: auction.minIncrementCents,
    currentBidCents: auction.currentBidCents,
    currentLeaderPublicId: auction.currentLeaderPublicId,
    bidCount: auction.bidCount,
    version: auction.version,
    startsAt: auction.startsAt.toISOString(),
    originalEndsAt: auction.originalEndsAt.toISOString(),
    endsAt: auction.endsAt.toISOString(),
    editionId: auction.editionId,
    workId: auction.workId,
    title: auction.title,
    authors: auction.authors,
    publisher: auction.publisher,
    publishedDate: auction.publishedDate,
    publishedYear: auction.publishedYear,
    isbn: auction.isbn,
    language: auction.language,
    description: auction.description,
    hasCover: auction.coverContentType !== null,
  };
}

function displayStatus(
  auction: Pick<AuctionView, 'status' | 'startsAt' | 'endsAt'>,
  now: Date,
): DisplayStatus {
  if (auction.status === 'CANCELLED') {
    return 'cancelled';
  }
  if (auction.endsAt.getTime() <= now.getTime()) {
    return 'ended';
  }
  if (auction.startsAt.getTime() > now.getTime()) {
    return 'scheduled';
  }
  return 'live';
}
