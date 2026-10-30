import { createHmac, timingSafeEqual } from 'crypto';

export const AUDIT_KEY_VERSION = 1;

export type AuditVerdict = 'INTEGRO' | 'ADULTERADO' | 'INDETERMINADO';

export type AuctionStateInput = {
  version: number;
  auctionId: string;
  status: string;
  sellerId: string;
  sellerPublicId: string;
  bidCount: number;
  currentBidCents: number | null;
  currentLeaderId: string | null;
  currentLeaderPublicId: string | null;
  startsAt: Date;
  originalEndsAt: Date;
  endsAt: Date;
  auditHeadHash: string;
  keyVersion: number;
};

export type AuctionAuditRow = {
  id: string;
  version: number;
  status: string;
  sellerId: string;
  sellerPublicId: string;
  bidCount: number;
  currentBidCents: number | null;
  currentLeaderId: string | null;
  currentLeaderPublicId: string | null;
  startsAt: Date;
  originalEndsAt: Date;
  endsAt: Date;
  auditHeadHash: string;
  auditStateMac: string;
  auditKeyVersion: number;
};

export type BidCanonicalInput = {
  auctionId: string;
  sequence: number;
  bidderId: string;
  bidderPublicId: string;
  amountCents: number;
  previousHash: string;
  endsAtAfter: Date;
  createdAt: Date;
};

export type BidChainInput = BidCanonicalInput & {
  hash: string;
};

export function canonicalGenesis(auctionId: string) {
  return ['canonicalVersion=1', 'kind=genesis', `auctionId=${auctionId}`].join('\n');
}

export function canonicalBid(bid: BidCanonicalInput) {
  return [
    'kind=bid',
    `auctionId=${bid.auctionId}`,
    `sequence=${bid.sequence}`,
    `bidderId=${bid.bidderId}`,
    `bidderPublicId=${bid.bidderPublicId}`,
    `amountCents=${bid.amountCents}`,
    `previousHash=${bid.previousHash}`,
    `endsAtAfter=${formatAuditInstant(bid.endsAtAfter)}`,
    `createdAt=${formatAuditInstant(bid.createdAt)}`,
  ].join('\n');
}

export function canonicalState(state: AuctionStateInput) {
  return [
    `version=${state.version}`,
    'kind=state',
    `auctionId=${state.auctionId}`,
    `status=${state.status}`,
    `sellerId=${state.sellerId}`,
    `sellerPublicId=${state.sellerPublicId}`,
    `bidCount=${state.bidCount}`,
    `currentBidCents=${state.currentBidCents ?? '-'}`,
    `currentLeaderId=${state.currentLeaderId ?? '-'}`,
    `currentLeaderPublicId=${state.currentLeaderPublicId ?? '-'}`,
    `startsAt=${formatAuditInstant(state.startsAt)}`,
    `originalEndsAt=${formatAuditInstant(state.originalEndsAt)}`,
    `endsAt=${formatAuditInstant(state.endsAt)}`,
    `auditHeadHash=${state.auditHeadHash}`,
    `keyVersion=${state.keyVersion}`,
  ].join('\n');
}

export function auditHmac(secret: string, canonical: string) {
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

export function verifyAuction(
  row: AuctionAuditRow,
  keys: ReadonlyMap<number, string>,
  bids: readonly BidChainInput[] = [],
): AuditVerdict {
  const secret = keys.get(row.auditKeyVersion);
  if (!secret) {
    return 'INDETERMINADO';
  }

  const genesis = auditHmac(secret, canonicalGenesis(row.id));
  if (row.bidCount === 0) {
    if (!macEqual(genesis, row.auditHeadHash) || bids.length > 0) {
      return 'ADULTERADO';
    }
    if (row.currentBidCents !== null || row.currentLeaderId !== null || row.currentLeaderPublicId !== null) {
      return 'ADULTERADO';
    }
  } else if (!bidChainIntact(row, secret, genesis, bids)) {
    return 'ADULTERADO';
  }

  const mac = auditHmac(
    secret,
    canonicalState({
      version: row.version,
      auctionId: row.id,
      status: row.status,
      sellerId: row.sellerId,
      sellerPublicId: row.sellerPublicId,
      bidCount: row.bidCount,
      currentBidCents: row.currentBidCents,
      currentLeaderId: row.currentLeaderId,
      currentLeaderPublicId: row.currentLeaderPublicId,
      startsAt: row.startsAt,
      originalEndsAt: row.originalEndsAt,
      endsAt: row.endsAt,
      auditHeadHash: row.auditHeadHash,
      keyVersion: row.auditKeyVersion,
    }),
  );

  if (!macEqual(mac, row.auditStateMac)) {
    return 'ADULTERADO';
  }

  return 'INTEGRO';
}

function bidChainIntact(
  row: AuctionAuditRow,
  secret: string,
  genesis: string,
  bids: readonly BidChainInput[],
) {
  if (bids.length !== row.bidCount) {
    return false;
  }

  const ordered = [...bids].sort((left, right) => left.sequence - right.sequence);
  let previous = genesis;
  for (let index = 0; index < ordered.length; index += 1) {
    const bid = ordered[index];
    if (bid.auctionId !== row.id || bid.sequence !== index + 1 || bid.previousHash !== previous) {
      return false;
    }
    const hash = auditHmac(secret, canonicalBid(bid));
    if (!macEqual(hash, bid.hash)) {
      return false;
    }
    previous = bid.hash;
  }

  const last = ordered[ordered.length - 1];
  if (!last) {
    return false;
  }
  return (
    macEqual(previous, row.auditHeadHash) &&
    last.amountCents === row.currentBidCents &&
    last.bidderId === row.currentLeaderId &&
    last.bidderPublicId === row.currentLeaderPublicId
  );
}

function formatAuditInstant(value: Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid audit instant');
  }
  return date.toISOString();
}

function macEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
