import { createHmac, timingSafeEqual } from 'crypto';

export const AUDIT_KEY_VERSION = 1;

export type AuditVerdict = 'INTEGRO' | 'ADULTERADO' | 'INDETERMINADO';

export type AuditFailureCode =
  | 'KEY_UNKNOWN'
  | 'BID_COUNT'
  | 'SEQUENCE'
  | 'BID_SCOPE'
  | 'PREVIOUS_HASH'
  | 'BID_HMAC'
  | 'HEAD'
  | 'LEADER'
  | 'CURRENT_BID'
  | 'UNSOLD'
  | 'STATE_MAC'
  | 'SELLER_LINK'
  | 'BIDDER_LINK'
  | 'LEADER_LINK';

export type AuditFailure = {
  code: AuditFailureCode;
  sequence: number | null;
  message: string;
};

export type AuditReport = {
  verdict: AuditVerdict;
  failures: AuditFailure[];
};

/** Live public ids for the internal ids stored on the lot. A missing user is `null`. */
export type AuditIdentities = {
  sellerPublicId: string | null;
  publicIdByUserId: ReadonlyMap<string, string | null>;
};

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

export function auditIdentities(
  sellerId: string,
  users: readonly { id: string; publicId: string }[],
): AuditIdentities {
  return {
    sellerPublicId: users.find((user) => user.id === sellerId)?.publicId ?? null,
    publicIdByUserId: new Map(users.map((user) => [user.id, user.publicId])),
  };
}

export function verifyAuction(
  row: AuctionAuditRow,
  keys: ReadonlyMap<number, string>,
  bids: readonly BidChainInput[] = [],
  identities?: AuditIdentities,
): AuditVerdict {
  return auditAuction(row, keys, bids, identities).verdict;
}

export function auditAuction(
  row: AuctionAuditRow,
  keys: ReadonlyMap<number, string>,
  bids: readonly BidChainInput[] = [],
  identities?: AuditIdentities,
): AuditReport {
  const secret = keys.get(row.auditKeyVersion);
  if (!secret) {
    return report('INDETERMINADO', [
      failure(
        'KEY_UNKNOWN',
        null,
        'A versão da chave de assinatura não está disponível. Não foi possível concluir a verificação.',
      ),
    ]);
  }

  const failures: AuditFailure[] = [];
  const genesis = auditHmac(secret, canonicalGenesis(row.id));
  const ordered = [...bids].sort((left, right) => left.sequence - right.sequence || left.hash.localeCompare(right.hash));

  if (ordered.length !== row.bidCount) {
    failures.push(failure('BID_COUNT', null, 'A quantidade de lances não confere com o registro do lote.'));
  }
  if (!ordered.every((bid, index) => bid.sequence === index + 1)) {
    failures.push(failure('SEQUENCE', null, 'A sequência dos lances não é contínua a partir de 1.'));
  }

  let previous = genesis;
  for (const bid of ordered) {
    if (bid.auctionId !== row.id) {
      failures.push(failure('BID_SCOPE', bid.sequence, 'Um lance não pertence a este lote.'));
    }
    if (bid.previousHash !== previous) {
      failures.push(
        failure('PREVIOUS_HASH', bid.sequence, 'O encadeamento deste lance não aponta para o hash anterior.'),
      );
    }
    const signed = signatureOf(secret, bid);
    if (!signed || !macEqual(signed, bid.hash)) {
      failures.push(
        failure('BID_HMAC', bid.sequence, 'A assinatura deste lance não confere com o conteúdo gravado.'),
      );
    }
    previous = bid.hash;
  }

  const head = ordered.length === 0 ? genesis : ordered[ordered.length - 1].hash;
  if (!macEqual(head, row.auditHeadHash)) {
    failures.push(
      failure(
        'HEAD',
        null,
        ordered.length === 0
          ? 'A âncora do histórico vazio não confere.'
          : 'A âncora do histórico não confere com o último lance.',
      ),
    );
  }

  if (ordered.length === 0) {
    if (row.currentBidCents !== null || row.currentLeaderId !== null || row.currentLeaderPublicId !== null) {
      failures.push(failure('LEADER', null, 'Um lote sem lances não pode ter valor atual nem líder.'));
    }
  } else {
    const last = ordered[ordered.length - 1];
    if (last.amountCents !== row.currentBidCents) {
      failures.push(failure('CURRENT_BID', last.sequence, 'O valor atual do lote não é o do último lance.'));
    }
    if (last.bidderId !== row.currentLeaderId || last.bidderPublicId !== row.currentLeaderPublicId) {
      failures.push(failure('LEADER', last.sequence, 'O líder do lote não é o autor do último lance.'));
    }
  }

  if (
    row.status === 'UNSOLD' &&
    (ordered.length > 0 ||
      row.bidCount !== 0 ||
      row.currentBidCents !== null ||
      row.currentLeaderId !== null ||
      row.currentLeaderPublicId !== null)
  ) {
    failures.push(failure('UNSOLD', null, 'Um lote sem vencedor não pode ter lances nem líder.'));
  }

  const mac = signatureOf(secret, null, row);
  if (!mac || !macEqual(mac, row.auditStateMac)) {
    failures.push(failure('STATE_MAC', null, 'O estado autenticado do lote não confere.'));
  }

  if (identities) {
    if (identities.sellerPublicId === null || identities.sellerPublicId !== row.sellerPublicId) {
      failures.push(
        failure('SELLER_LINK', null, 'A identificação pública do leiloeiro não corresponde ao cadastro.'),
      );
    }
    for (const bid of ordered) {
      const live = identities.publicIdByUserId.get(bid.bidderId);
      if (live == null || live !== bid.bidderPublicId) {
        failures.push(
          failure('BIDDER_LINK', bid.sequence, 'A identificação pública do licitante não corresponde ao cadastro.'),
        );
      }
    }
    if (row.currentLeaderId) {
      const live = identities.publicIdByUserId.get(row.currentLeaderId);
      if (live == null || live !== row.currentLeaderPublicId) {
        failures.push(failure('LEADER_LINK', null, 'A identificação pública do líder não corresponde ao cadastro.'));
      }
    }
  }

  return report(failures.length === 0 ? 'INTEGRO' : 'ADULTERADO', failures);
}

function signatureOf(secret: string, bid: BidCanonicalInput | null, row?: AuctionAuditRow) {
  try {
    if (bid) {
      return auditHmac(secret, canonicalBid(bid));
    }
    if (!row) {
      return null;
    }
    return auditHmac(
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
  } catch {
    return null;
  }
}

function report(verdict: AuditVerdict, failures: AuditFailure[]): AuditReport {
  return { verdict, failures };
}

function failure(code: AuditFailureCode, sequence: number | null, message: string): AuditFailure {
  return { code, sequence, message };
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
