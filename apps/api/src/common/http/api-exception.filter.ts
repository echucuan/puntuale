import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError, ApiErrorCode } from '@puntuale/contracts';
import type { Response } from 'express';

const CODE_BY_STATUS: Partial<Record<number, ApiErrorCode>> = {
  [HttpStatus.UNAUTHORIZED]: 'unauthenticated',
  [HttpStatus.NOT_FOUND]: 'not_found',
  [HttpStatus.CONFLICT]: 'conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'validation_failed',
};

const MESSAGE_BY_CODE: Record<ApiErrorCode, string> = {
  unauthenticated: 'Se requiere una sesión.',
  not_found: 'No encontrado.',
  validation_failed: 'Los datos enviados no son válidos.',
  conflict: 'El recurso entra en conflicto con uno existente.',
  internal_error: 'Ocurrió un error interno.',
};

/**
 * Convierte cualquier error en la forma única `ApiError` (`@puntuale/contracts`).
 * Nunca expone detalles internos (SQL, pilas, valores). Un 404 no distingue
 * "no existe" de "no tienes acceso".
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const code: ApiErrorCode = CODE_BY_STATUS[status] ?? 'internal_error';
    if (code === 'internal_error') {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    const body: ApiError = { error: { code, message: MESSAGE_BY_CODE[code] } };
    response
      .status(code === 'internal_error' ? HttpStatus.INTERNAL_SERVER_ERROR : status)
      .json(body);
  }
}
