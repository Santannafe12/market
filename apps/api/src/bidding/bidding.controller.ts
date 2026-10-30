import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { AccessTokenPayload } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SettleBeforeReadInterceptor } from '../settlement/settle-before-read.interceptor';
import { BiddingService } from './bidding.service';
import { PlaceBidDto } from './dto/place-bid.dto';

@Controller('auctions')
export class BiddingController {
  constructor(private readonly bidding: BiddingService) {}

  @Get(':id/bids')
  @UseInterceptors(SettleBeforeReadInterceptor)
  list(@Param('id') id: string) {
    return this.bidding.list(id);
  }

  @Post(':id/bids')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  place(
    @Req() request: { user: AccessTokenPayload },
    @Param('id') id: string,
    @Body() dto: PlaceBidDto,
  ) {
    return this.bidding.placeBid(request.user.sub, id, dto.amountCents);
  }
}
