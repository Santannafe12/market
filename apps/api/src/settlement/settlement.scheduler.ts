import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { validateEnv } from '../config/env';
import { DemoSeed } from '../demo/demo-seed';
import { FinalizeOutcome, SettlementService } from './settlement.service';

const INTERVAL_NAME = 'settlement';
/** Without an interval, reads renew the demo lots at most this often per instance. */
const DEMO_ENSURE_ON_READ_MS = 60_000;

@Injectable()
export class SettlementScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettlementScheduler.name);
  private running = false;
  private demoEnsure = false;
  private settleOnRead = true;
  private intervalActive = false;
  private lastDemoEnsureOnRead = 0;
  /** One due scan per process at a time. Tick and reads share it instead of racing the cursor. */
  private scan: Promise<FinalizeOutcome[]> | null = null;

  constructor(
    private readonly settlement: SettlementService,
    private readonly registry: SchedulerRegistry,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    const env = validateEnv(process.env);
    this.demoEnsure = env.demoEnsure;
    this.settleOnRead = env.settleOnRead;
    if (env.serverless) {
      return;
    }
    const timer = setInterval(() => {
      void this.tick();
    }, settlementIntervalMs());
    this.registry.addInterval(INTERVAL_NAME, timer);
    this.intervalActive = true;
  }

  onModuleDestroy() {
    if (this.registry.doesExist('interval', INTERVAL_NAME)) {
      this.registry.deleteInterval(INTERVAL_NAME);
    }
  }

  /**
   * Called before a read answers. With `auctionId` only that lot is checked; without it, one due page.
   * Every lot settles in its own locked transaction, so concurrent reads in any number of
   * instances still produce one debit and one receipt. Never throws: the read goes on.
   */
  async beforeRead(auctionId?: string) {
    if (!this.settleOnRead) {
      return;
    }
    try {
      if (auctionId) {
        await this.settlement.finalizeIfDue(auctionId);
      } else {
        await this.scanDue();
      }
    } catch {
      this.logger.error('Falha ao liquidar antes da leitura.');
    }
    if (this.demoEnsure && !this.intervalActive && Date.now() - this.lastDemoEnsureOnRead >= DEMO_ENSURE_ON_READ_MS) {
      this.lastDemoEnsureOnRead = Date.now();
      await this.ensureDemo();
    }
  }

  private scanDue() {
    this.scan ??= this.settlement.finalizeDueAuctions().finally(() => {
      this.scan = null;
    });
    return this.scan;
  }

  private async tick() {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      try {
        await this.scanDue();
      } catch {
        this.logger.error('Falha no ciclo de liquidação.');
      }
      // After settlement and outside its transactions: an expired live demo is replaced without a restart.
      if (this.demoEnsure) {
        await this.ensureDemo();
      }
    } finally {
      this.running = false;
    }
  }

  private async ensureDemo() {
    try {
      await this.moduleRef.get(DemoSeed, { strict: false }).run();
    } catch {
      this.logger.error('Falha ao renovar os lotes de demonstração.');
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
