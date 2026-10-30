import {
  auditHmac,
  auditAuction,
  canonicalBid,
  canonicalGenesis,
  canonicalState,
  verifyAuction,
  type AuctionStateInput,
} from '../src/audit/audit';

const secret = 'a'.repeat(32);
const auctionId = '11111111-1111-4111-8111-111111111111';
const sellerId = '22222222-2222-4222-8222-222222222222';
const startsAt = new Date('2026-01-02T03:04:05.006Z');
const endsAt = new Date('2026-01-02T04:05:06.007Z');

function state(): AuctionStateInput {
  return {
    version: 0,
    auctionId,
    status: 'OPEN',
    sellerId,
    sellerPublicId: 'JOSÉ',
    bidCount: 0,
    currentBidCents: null,
    currentLeaderId: null,
    currentLeaderPublicId: null,
    startsAt,
    originalEndsAt: endsAt,
    endsAt,
    auditHeadHash: auditHmac(secret, canonicalGenesis(auctionId)),
    keyVersion: 1,
  };
}

describe('audit anchor', () => {
  it('canonicalizes genesis and state as UTF-8 lines without a trailing newline', () => {
    const current = state();
    const genesis = canonicalGenesis(auctionId);
    expect(genesis).toBe(
      ['canonicalVersion=1', 'kind=genesis', `auctionId=${auctionId}`].join('\n'),
    );
    expect(genesis.endsWith('\n')).toBe(false);
    expect(canonicalState(current)).toBe(
      [
        'version=0',
        'kind=state',
        `auctionId=${auctionId}`,
        'status=OPEN',
        `sellerId=${sellerId}`,
        'sellerPublicId=JOSÉ',
        'bidCount=0',
        'currentBidCents=-',
        'currentLeaderId=-',
        'currentLeaderPublicId=-',
        'startsAt=2026-01-02T03:04:05.006Z',
        'originalEndsAt=2026-01-02T04:05:06.007Z',
        'endsAt=2026-01-02T04:05:06.007Z',
        `auditHeadHash=${current.auditHeadHash}`,
        'keyVersion=1',
      ].join('\n'),
    );
    expect(canonicalState(current).endsWith('\n')).toBe(false);
    expect(auditHmac(secret, genesis)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts an intact empty history and rejects a tampered seller, a leader on a empty lot, or an unknown key', () => {
    const current = state();
    const keys = new Map([[1, secret]]);
    const intact = {
      id: auctionId,
      version: current.version,
      status: current.status,
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
      auditStateMac: auditHmac(secret, canonicalState(current)),
      auditKeyVersion: 1,
    };
    expect(verifyAuction(intact, keys)).toBe('INTEGRO');
    expect(verifyAuction({ ...intact, sellerId: '99999999-9999-4999-8999-999999999999' }, keys)).toBe(
      'ADULTERADO',
    );
    expect(verifyAuction({ ...intact, auditKeyVersion: 99 }, keys)).toBe('INDETERMINADO');
    const unsoldState = { ...current, status: 'UNSOLD' };
    expect(
      verifyAuction(
        { ...intact, status: 'UNSOLD', auditStateMac: auditHmac(secret, canonicalState(unsoldState)) },
        keys,
      ),
    ).toBe('INTEGRO');
    const unsoldWithBid = {
      ...unsoldState,
      bidCount: 1,
      currentBidCents: 10,
      currentLeaderId: sellerId,
      currentLeaderPublicId: 'JOSÉ',
    };
    expect(
      verifyAuction(
        {
          ...intact,
          ...unsoldWithBid,
          auditStateMac: auditHmac(secret, canonicalState(unsoldWithBid)),
        },
        keys,
      ),
    ).toBe('ADULTERADO');

    const dirty = {
      ...current,
      currentLeaderId: '33333333-3333-4333-8333-333333333333',
    };
    expect(
      verifyAuction(
        {
          ...intact,
          currentLeaderId: dirty.currentLeaderId,
          auditStateMac: auditHmac(secret, canonicalState(dirty)),
        },
        keys,
      ),
    ).toBe('ADULTERADO');
  });

  it('chains a bid from the genesis head and rejects a swapped leader without rewriting the anchor', () => {
    const bidderId = '33333333-3333-4333-8333-333333333333';
    const createdAt = new Date('2026-01-02T04:03:06.007Z');
    const endsAtAfter = new Date('2026-01-02T04:07:06.007Z');
    const genesis = auditHmac(secret, canonicalGenesis(auctionId));
    const bid = {
      auctionId,
      sequence: 1,
      bidderId,
      bidderPublicId: 'ANA',
      amountCents: 4000,
      previousHash: genesis,
      endsAtAfter,
      createdAt,
    };
    const canonical = canonicalBid(bid);
    expect(canonical).toBe(
      [
        'kind=bid',
        `auctionId=${auctionId}`,
        'sequence=1',
        `bidderId=${bidderId}`,
        'bidderPublicId=ANA',
        'amountCents=4000',
        `previousHash=${genesis}`,
        'endsAtAfter=2026-01-02T04:07:06.007Z',
        'createdAt=2026-01-02T04:03:06.007Z',
      ].join('\n'),
    );
    expect(canonical.endsWith('\n')).toBe(false);

    const hash = auditHmac(secret, canonical);
    const current = {
      ...state(),
      version: 1,
      bidCount: 1,
      currentBidCents: 4000,
      currentLeaderId: bidderId,
      currentLeaderPublicId: 'ANA',
      endsAt: endsAtAfter,
      auditHeadHash: hash,
    };
    const row = {
      id: auctionId,
      version: current.version,
      status: current.status,
      sellerId: current.sellerId,
      sellerPublicId: current.sellerPublicId,
      bidCount: current.bidCount,
      currentBidCents: current.currentBidCents,
      currentLeaderId: current.currentLeaderId,
      currentLeaderPublicId: current.currentLeaderPublicId,
      startsAt: current.startsAt,
      originalEndsAt: current.originalEndsAt,
      endsAt: current.endsAt,
      auditHeadHash: hash,
      auditStateMac: auditHmac(secret, canonicalState(current)),
      auditKeyVersion: 1,
    };
    const keys = new Map([[1, secret]]);
    const signed = [{ ...bid, hash }];
    expect(verifyAuction(row, keys, signed)).toBe('INTEGRO');
    const tampered = { ...row, currentLeaderId: sellerId };
    expect(verifyAuction(tampered, keys, signed)).toBe('ADULTERADO');
    expect(tampered.auditHeadHash).toBe(hash);
    const relinked = auditAuction(row, keys, signed, {
      sellerPublicId: 'JOSÉ',
      publicIdByUserId: new Map([
        [sellerId, 'JOSÉ'],
        [bidderId, 'OUTRA'],
      ]),
    });
    expect(relinked.verdict).toBe('ADULTERADO');
    expect(relinked.failures.map((item) => item.code)).toEqual(expect.arrayContaining(['BIDDER_LINK', 'LEADER_LINK']));
    expect(relinked.failures.map((item) => item.code)).not.toContain('BID_HMAC');
    expect(JSON.stringify(relinked)).not.toContain(bidderId);
  });
});
