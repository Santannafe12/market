import { Injectable } from '@nestjs/common';
import { validateEnv } from '../config/env';
import {
  AUDIT_KEY_VERSION,
  AuctionAuditRow,
  AuctionStateInput,
  auditHmac,
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

  verify(row: AuctionAuditRow) {
    return verifyAuction(row, new Map([[this.keyVersion, this.secret]]));
  }
}
