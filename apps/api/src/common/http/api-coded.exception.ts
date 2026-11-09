import { HttpException } from '@nestjs/common';
import type { ApiErrorCode } from '@puntuale/contracts';

/** Error HTTP con un código `ApiError` explícito, para cuando el estado no basta para distinguirlo. */
export class ApiCodedException extends HttpException {
  constructor(
    status: number,
    readonly code: ApiErrorCode,
  ) {
    super(code, status);
  }
}
