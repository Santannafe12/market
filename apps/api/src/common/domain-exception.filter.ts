import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';
import { DomainError } from './domain-error';

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') {
      return;
    }
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainError) {
      response.status(exception.status).json({
        code: exception.code,
        message: exception.message,
      });
      return;
    }

    if (exception instanceof BadRequestException) {
      const body = exception.getResponse();
      const raw =
        typeof body === 'object' && body !== null && 'message' in body
          ? (body as { message: string | string[] }).message
          : exception.message;
      const message = Array.isArray(raw) ? raw.join(' ') : String(raw);
      response.status(400).json({ code: 'VALIDATION_ERROR', message });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({
        code: status === 401 ? 'UNAUTHORIZED' : 'HTTP_ERROR',
        message: exception.message,
      });
      return;
    }

    response.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Erro interno.',
    });
  }
}
