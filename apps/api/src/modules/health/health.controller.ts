import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { HealthResponse } from '@puntuale/contracts';
import type { Response } from 'express';
import { HealthService } from './health.service';

/** `GET /health`: fuera del prefijo `/api` y sin sesión. No revela datos de ninguna empresa. */
@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthResponse> {
    const result = await this.health.check();
    if (result.status !== 'ok') response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
