import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SettlementController } from './settlement.controller';
import { SettlementScheduler } from './settlement.scheduler';
import { SettlementService } from './settlement.service';

@Module({
  imports: [AuthModule, AuditModule, ScheduleModule.forRoot()],
  controllers: [SettlementController],
  providers: [SettlementService, SettlementScheduler],
  exports: [SettlementService],
})
export class SettlementModule {}
