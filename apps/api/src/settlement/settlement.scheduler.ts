import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { validateEnv } from '../config/env';
import { DemoSeed } from '../demo/demo-seed';
import { SettlementService } from './settlement.service';

const INTERVAL_NAME = 'settlement';

@Injectable()
export class SettlementScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettlementScheduler.name);
  private running = false;
  private demoEnsure = false;

  constructor(
    private readonly settlement: SettlementService,
    private readonly registry: SchedulerRegistry,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    this.demoEnsure = validateEnv(process.env).demoEnsure;
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
      try {
        await this.settlement.finalizeDueAuctions();
      } catch {
        this.logger.error('Falha no ciclo de liquidação.');
      }
      // After settlement and outside its transactions: an expired live demo is replaced without a restart.
      if (this.demoEnsure) {
        try {
          await this.moduleRef.get(DemoSeed, { strict: false }).run();
        } catch {
          this.logger.error('Falha ao renovar os lotes de demonstração.');
        }
      }
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
