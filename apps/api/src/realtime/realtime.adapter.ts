import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

/** Same allowed origin as the HTTP API. One process, no Redis adapter. */
export class RealtimeAdapter extends IoAdapter {
  constructor(
    app: INestApplication,
    private readonly origin: string,
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
