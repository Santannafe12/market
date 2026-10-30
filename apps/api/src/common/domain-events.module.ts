import { Global, Module } from '@nestjs/common';
import { DomainEvents } from './domain-events';

@Global()
@Module({
  providers: [DomainEvents],
  exports: [DomainEvents],
})
export class DomainEventsModule {}
