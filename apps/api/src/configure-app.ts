import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import { AppEnv } from './config/env';
import { RealtimeAdapter } from './realtime/realtime.adapter';

export function configureApp(app: INestApplication, env: AppEnv) {
  app.useWebSocketAdapter(new RealtimeAdapter(app, env.webOrigin));
  app.setGlobalPrefix('api');
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.enableCors({
    origin: env.webOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new DomainExceptionFilter());
}
