import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { validateEnv } from './config/env';
import { DemoSeed } from './demo/demo-seed';

loadDotenv({ path: resolve(process.cwd(), '../../.env') });
loadDotenv({ path: resolve(process.cwd(), '.env') });
loadDotenv({ path: resolve(__dirname, '../../../.env') });

async function bootstrap() {
  const env = validateEnv(process.env);
  const app = await NestFactory.create(AppModule);
  configureApp(app, env);
  app.enableShutdownHooks();
  await app.listen(env.port);
  if (env.seedOnBoot) {
    try {
      await app.get(DemoSeed).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'erro desconhecido';
      Logger.error(`Seed de demonstração falhou na subida: ${message}`, 'Bootstrap');
    }
  }
}

void bootstrap();
