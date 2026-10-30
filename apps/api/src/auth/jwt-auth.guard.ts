import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DomainError } from '../common/domain-error';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest<T>(err: unknown, user: T) {
    if (err || !user) {
      throw new DomainError('UNAUTHORIZED', 401, 'Autenticação necessária.');
    }
    return user;
  }
}
