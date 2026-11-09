import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../../database/tenant-transaction';
import type { RateLimitHit, RateLimitScope, RateLimitStore } from '../domain/rate-limit-store';

/** Una de cada tantas peticiones limpia los contadores vencidos. */
const PURGE_ONE_IN = 500;

/** Contador por minuto en PostgreSQL, atómico por llave y ventana (ADR 0014). */
@Injectable()
export class PostgresRateLimitStore implements RateLimitStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async hit(scope: RateLimitScope, keyHash: string): Promise<RateLimitHit> {
    const { rows } = await this.pool.query<{ hits: number; retry_after: number }>(
      `INSERT INTO rate_limit_bucket (scope, key_hash, window_start, hits)
       VALUES ($1, $2, date_bin('1 minute', statement_timestamp(), TIMESTAMPTZ '2000-01-01 00:00:00+00'), 1)
       ON CONFLICT (scope, key_hash, window_start)
         DO UPDATE SET hits = rate_limit_bucket.hits + 1
       RETURNING hits,
                 ceil(extract(epoch FROM window_start + interval '1 minute' - statement_timestamp()))::int AS retry_after`,
      [scope, keyHash],
    );
    if (randomInt(PURGE_ONE_IN) === 0) await this.pool.query('SELECT auth_purge_throttle()');
    const row = rows[0]!;
    return { hits: row.hits, retryAfterSeconds: Math.max(1, row.retry_after) };
  }
}
