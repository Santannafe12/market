import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SettlementModule } from '../settlement/settlement.module';
import { BiddingController } from './bidding.controller';
import { BiddingService } from './bidding.service';

@Module({
  imports: [AuthModule, AuditModule, SettlementModule],
  controllers: [BiddingController],
  providers: [BiddingService],
  exports: [BiddingService],
})
export class BiddingModule {}