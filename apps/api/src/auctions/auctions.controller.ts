import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { AccessTokenPayload } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuctionsService } from './auctions.service';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { ListAuctionsQueryDto } from './dto/list-auctions.dto';

@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctions: AuctionsService) {}

  @Get('mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  mine(@Req() request: { user: AccessTokenPayload }) {
    return this.auctions.mine(request.user.sub);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  list(@Query() query: ListAuctionsQueryDto) {
    return this.auctions.list(query.status);
  }

  @Get(':id/audit')
  audit(@Param('id') id: string) {
    return this.auctions.readAudit(id);
  }

  @Get(':id/cover')
  async cover(@Param('id') id: string, @Res({ passthrough: true }) response: Response) {
    const cover = await this.auctions.cover(id);
    response.setHeader('Content-Type', cover.contentType);
    response.setHeader('Cache-Control', 'public, max-age=86400');
    return new StreamableFile(cover.bytes);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  detail(@Param('id') id: string) {
    return this.auctions.detail(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  create(@Req() request: { user: AccessTokenPayload }, @Body() dto: CreateAuctionDto) {
    return this.auctions.create(request.user.sub, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  cancel(@Req() request: { user: AccessTokenPayload }, @Param('id') id: string) {
    return this.auctions.cancel(request.user.sub, id);
  }
}
