import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SettleBeforeReadInterceptor } from './settle-before-read.interceptor';
import { SettlementController } from './settlement.controller';
import { SettlementScheduler } from './settlement.scheduler';
import { SettlementService } from './settlement.service';

@Module({
  imports: [AuthModule, AuditModule, ScheduleModule.forRoot()],
  controllers: [SettlementController],
  providers: [SettlementService, SettlementScheduler, SettleBeforeReadInterceptor],
  exports: [SettlementService, SettlementScheduler, SettleBeforeReadInterceptor],
})
export class SettlementModule {}
