import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CATALOG_FETCH, CatalogClient } from './catalog.client';
import { CatalogController } from './catalog.controller';

@Module({
  imports: [AuthModule],
  controllers: [CatalogController],
  providers: [
    CatalogClient,
    {
      provide: CATALOG_FETCH,
      useValue: globalThis.fetch.bind(globalThis),
    },
  ],
  exports: [CatalogClient],
})
export class CatalogModule {}
