import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { AccessTokenPayload } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SettlementService } from './settlement.service';

@Controller()
export class SettlementController {
  constructor(private readonly settlement: SettlementService) {}

  @Get('receipts/:publicToken')
  receipt(@Param('publicToken') publicToken: string) {
    return this.settlement.receipt(publicToken);
  }

  @Get('me/participations')
  @UseGuards(JwtAuthGuard)
  participations(@Req() request: { user: AccessTokenPayload }) {
    return this.settlement.participations(request.user.sub);
  }
}
