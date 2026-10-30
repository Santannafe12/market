import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SettlementService } from './settlement.service';

const INTERVAL_NAME = 'settlement';

@Injectable()
export class SettlementScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettlementScheduler.name);
  private running = false;

  constructor(
    private readonly settlement: SettlementService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit() {
    const timer = setInterval(() => {
      void this.tick();
    }, settlementIntervalMs());
    this.registry.addInterval(INTERVAL_NAME, timer);
  }

  onModuleDestroy() {
    if (this.registry.doesExist('interval', INTERVAL_NAME)) {
      this.registry.deleteInterval(INTERVAL_NAME);
    }
  }

  private async tick() {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.settlement.finalizeDueAuctions();
    } catch {
      this.logger.error('Falha no ciclo de liquidação.');
    } finally {
      this.running = false;
    }
  }
}

/** Read after env files load. Values below one second fall back to the default so a tick cannot spin. */
export function settlementIntervalMs(raw = process.env.SETTLEMENT_INTERVAL_MS) {
  const parsed = Number(raw ?? 5_000);
  if (!Number.isInteger(parsed) || parsed < 1_000) {
    return 5_000;
  }
  return parsed;
}
