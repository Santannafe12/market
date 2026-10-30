import { Module } from '@nestjs/common';
import { AuctionsModule } from '../auctions/auctions.module';
import { AuthModule } from '../auth/auth.module';
import { BiddingModule } from '../bidding/bidding.module';
import { SettlementModule } from '../settlement/settlement.module';
import { WalletModule } from '../wallet/wallet.module';
import { DemoSeed } from './demo-seed';

@Module({
  imports: [AuthModule, WalletModule, AuctionsModule, BiddingModule, SettlementModule],
  providers: [DemoSeed],
  exports: [DemoSeed],
})
export class DemoModule {}
