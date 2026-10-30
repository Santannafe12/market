import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

/**
 * Same allowed origins as the HTTP API. No Redis adapter: on Vercel each Function instance
 * only reaches the sockets it accepted, and the room's REST refresh covers the rest.
 */
export class RealtimeAdapter extends IoAdapter {
  constructor(
    app: INestApplication,
    private readonly origin: string[],
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.origin,
        methods: ['GET', 'POST'],
        allowedHeaders: ['Authorization', 'Content-Type'],
      },
    });
  }
}
