import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AccessTokenPayload } from '../auth/jwt.strategy';
import { auctionRoom, DomainEvents, userRoom } from '../common/domain-events';
import { PrismaService } from '../prisma/prisma.service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly events: DomainEvents,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  afterInit(server: Server) {
    this.events.bind(server);
  }

  handleConnection(socket: Socket) {
    const token = readToken(socket);
    if (!token) {
      return;
    }
    try {
      const payload = this.jwt.verify<AccessTokenPayload>(token);
      if (!payload || typeof payload.sub !== 'string' || payload.sub.length === 0) {
        return;
      }
      socket.data.userId = payload.sub;
      void Promise.resolve(socket.join(userRoom(payload.sub))).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'erro desconhecido';
        this.logger.error(`Falha ao entrar na sala privada: ${message}`);
      });
    } catch {
      return;
    }
  }

  @SubscribeMessage('auction.join')
  async joinAuction(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const auctionId = readAuctionId(body);
    if (!auctionId) {
      return { ok: false };
    }
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      select: { id: true },
    });
    if (!auction) {
      return { ok: false };
    }
    for (const room of socket.rooms) {
      if (room.startsWith('auction:') && room !== auctionRoom(auctionId)) {
        await socket.leave(room);
      }
    }
    await socket.join(auctionRoom(auctionId));
    return { ok: true };
  }
}

function readToken(socket: Socket) {
  const token = socket.handshake.auth?.token;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

function readAuctionId(body: unknown) {
  if (!body || typeof body !== 'object' || !('auctionId' in body)) {
    return null;
  }
  const auctionId = (body as { auctionId?: unknown }).auctionId;
  if (typeof auctionId !== 'string' || !UUID_PATTERN.test(auctionId)) {
    return null;
  }
  return auctionId;
}
