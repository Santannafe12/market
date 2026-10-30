import { Injectable } from '@nestjs/common';
import { validateEnv } from '../config/env';
import {
  AUDIT_KEY_VERSION,
  AuctionAuditRow,
  AuctionStateInput,
  BidCanonicalInput,
  BidChainInput,
  auditHmac,
  canonicalBid,
  canonicalGenesis,
  canonicalState,
  verifyAuction,
} from './audit';

@Injectable()
export class AuditService {
  readonly keyVersion = AUDIT_KEY_VERSION;
  private readonly secret: string;

  constructor() {
    this.secret = validateEnv(process.env).auditHmacSecret;
  }

  genesisHash(auctionId: string) {
    return auditHmac(this.secret, canonicalGenesis(auctionId));
  }

  stateMac(state: AuctionStateInput) {
    return auditHmac(this.secret, canonicalState(state));
  }

  bidHash(bid: BidCanonicalInput) {
    return auditHmac(this.secret, canonicalBid(bid));
  }

  verify(row: AuctionAuditRow, bids: readonly BidChainInput[] = []) {
    return verifyAuction(row, new Map([[this.keyVersion, this.secret]]), bids);
  }
}
