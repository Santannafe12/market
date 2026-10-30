import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AuctionsController } from './auctions.controller';
import { AuctionsService } from './auctions.service';

@Module({
  imports: [AuthModule, AuditModule, CatalogModule],
  controllers: [AuctionsController],
  providers: [AuctionsService],
})
export class AuctionsModule {}
