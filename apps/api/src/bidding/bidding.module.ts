import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BiddingController } from './bidding.controller';
import { BiddingService } from './bidding.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [BiddingController],
  providers: [BiddingService],
})
export class BiddingModule {}