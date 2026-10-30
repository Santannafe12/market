import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { DomainError } from '../common/domain-error';
import { AccessTokenPayload } from './jwt.strategy';

export const ROLES_KEY = 'roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!roles || roles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AccessTokenPayload }>();
    if (!request.user || !roles.includes(request.user.role)) {
      throw new DomainError('FORBIDDEN', 403, 'Você não tem permissão para esta operação.');
    }

    return true;
  }
}
