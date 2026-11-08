import { Inject, Injectable } from '@nestjs/common';
import type { HealthResponse } from '@puntuale/contracts';
import type { Pool } from 'pg';
import { PG_POOL } from '../../database/tenant-transaction';

@Injectable()
export class HealthService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async check(): Promise<HealthResponse> {
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch {
      return { status: 'degraded', database: 'down' };
    }
  }
}
