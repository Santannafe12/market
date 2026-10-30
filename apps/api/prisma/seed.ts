import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { validateEnv } from '../src/config/env';
import { DemoSeed } from '../src/demo/demo-seed';

loadDotenv({ path: resolve(__dirname, '../../../.env'), quiet: true });
loadDotenv({ path: resolve(__dirname, '../.env'), quiet: true });

/** Same function as SEED_ON_BOOT and DEMO_ENSURE. Safe to repeat; it reads only the local fixture. */
async function main() {
  validateEnv(process.env);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const report = await app.get(DemoSeed).run();
    if (report.skipped) {
      console.log('Outro seed está em execução neste banco. Nada foi feito.');
    } else if (report.created.length === 0 && report.deposits.length === 0) {
      console.log('Demonstração já estava completa. Nada foi criado.');
    }
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.problems.length > 0 ? 1 : 0;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
