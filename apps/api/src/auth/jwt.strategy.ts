import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { validateEnv } from '../config/env';

export type AccessTokenPayload = {
  sub: string;
  role: Role;
  publicId: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: validateEnv(process.env).jwtSecret,
      ignoreExpiration: false,
    });
  }

  validate(payload: AccessTokenPayload): AccessTokenPayload {
    return {
      sub: payload.sub,
      role: payload.role,
      publicId: payload.publicId,
    };
  }
}
