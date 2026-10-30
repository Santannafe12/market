import { Injectable } from '@nestjs/common';

/** Empty stand-in. Realtime delivery arrives in a later plan, and only after commit. */
@Injectable()
export class DomainEvents {
  auctionChanged(_auctionId: string) {}

  walletHint(_userId: string) {}
}
