import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuctionsModule } from './auctions/auctions.module';
import { BiddingModule } from './bidding/bidding.module';
import { CatalogModule } from './catalog/catalog.module';
import { DomainEventsModule } from './common/domain-events.module';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: (env) => validateEnv(env),
    }),
    PrismaModule,
    DomainEventsModule,
    AuthModule,
    AuditModule,
    CatalogModule,
    AuctionsModule,
    WalletModule,
    BiddingModule,
  ],
})
export class AppModule {}
