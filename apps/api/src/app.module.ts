import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuctionsModule } from './auctions/auctions.module';
import { CatalogModule } from './catalog/catalog.module';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: (env) => validateEnv(env),
    }),
    PrismaModule,
    AuthModule,
    AuditModule,
    CatalogModule,
    AuctionsModule,
  ],
})
export class AppModule {}
