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
import { ApiCodedException } from './api-coded.exception';

const CODE_BY_STATUS: Partial<Record<number, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'validation_failed',
  [HttpStatus.UNAUTHORIZED]: 'unauthenticated',
  [HttpStatus.FORBIDDEN]: 'forbidden',
  [HttpStatus.NOT_FOUND]: 'not_found',
  [HttpStatus.CONFLICT]: 'conflict',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'payload_too_large',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'validation_failed',
  [HttpStatus.TOO_MANY_REQUESTS]: 'rate_limited',
};

const MESSAGE_BY_CODE: Record<ApiErrorCode, string> = {
  unauthenticated: 'Se requiere una sesión.',
  not_found: 'No encontrado.',
  validation_failed: 'Los datos enviados no son válidos.',
  conflict: 'El recurso entra en conflicto con uno existente.',
  internal_error: 'Ocurrió un error interno.',
  invalid_credentials: 'Correo o contraseña incorrectos.',
  forbidden: 'La solicitud fue rechazada por seguridad.',
  rate_limited: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
  payload_too_large: 'La solicitud es demasiado grande.',
  permission_denied: 'No tienes permiso para esta acción.',
  mfa_required: 'Completa la verificación en dos pasos para continuar.',
  mfa_enrollment_required: 'Configura la verificación en dos pasos para continuar.',
  invalid_mfa_code: 'El código no es válido.',
  last_admin: 'La empresa debe conservar al menos una persona propietaria con acceso activo.',
  self_modification: 'No puedes cambiar tu propio acceso.',
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
    const code: ApiErrorCode =
      exception instanceof ApiCodedException
        ? exception.code
        : (CODE_BY_STATUS[status] ?? 'internal_error');
    if (code === 'internal_error') {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    const body: ApiError = { error: { code, message: MESSAGE_BY_CODE[code] } };
    response
      .status(code === 'internal_error' ? HttpStatus.INTERNAL_SERVER_ERROR : status)
      .json(body);
  }
}
