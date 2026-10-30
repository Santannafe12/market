import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SettlementScheduler } from './settlement.scheduler';

/**
 * Settles due lots before a read answers, so a Function without the interval still shows final
 * state. Runs after the guards. A route with `:id` checks only that lot.
 */
@Injectable()
export class SettleBeforeReadInterceptor implements NestInterceptor {
  constructor(private readonly scheduler: SettlementScheduler) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<{ params?: Record<string, string | undefined> }>();
    await this.scheduler.beforeRead(request.params?.id);
    return next.handle();
  }
}
