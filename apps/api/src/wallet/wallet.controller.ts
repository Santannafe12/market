import { Body, Controller, Get, HttpCode, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AccessTokenPayload } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SettleBeforeReadInterceptor } from '../settlement/settle-before-read.interceptor';
import { DepositDto } from './dto/deposit.dto';
import { WalletService } from './wallet.service';

@Controller('wallet')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BIDDER)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @UseInterceptors(SettleBeforeReadInterceptor)
  view(@Req() request: { user: AccessTokenPayload }) {
    return this.wallet.view(request.user.sub);
  }

  @Post('deposits')
  @HttpCode(201)
  deposit(@Req() request: { user: AccessTokenPayload }, @Body() dto: DepositDto) {
    return this.wallet.deposit(request.user.sub, dto.amountCents);
  }
}
