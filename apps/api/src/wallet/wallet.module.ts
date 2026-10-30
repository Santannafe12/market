import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SettlementModule } from '../settlement/settlement.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [AuthModule, SettlementModule],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
