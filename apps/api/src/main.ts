import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { validateEnv } from './config/env';

loadDotenv({ path: resolve(process.cwd(), '../../.env') });
loadDotenv({ path: resolve(process.cwd(), '.env') });
loadDotenv({ path: resolve(__dirname, '../../../.env') });

async function bootstrap() {
  const env = validateEnv(process.env);
  const app = await NestFactory.create(AppModule);
  configureApp(app, env);
  app.enableShutdownHooks();
  await app.listen(env.port);
}

void bootstrap();
