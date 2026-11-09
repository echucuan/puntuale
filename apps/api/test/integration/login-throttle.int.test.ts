import { startTestDatabase, type TestDatabase } from '@puntuale/db/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTransaction } from '../../src/database/transaction';
import { evaluateLoginThrottle } from '../../src/modules/identity/domain/login-throttle';
import {
  insertLoginAttempt,
  lockThrottleKeys,
  readThrottleSnapshot,
} from '../../src/modules/identity/infrastructure/login-throttle.repository';

const LIMITS = {
  maxFailuresPerAccount: 1_000,
  maxFailuresPerIp: 12,
  windowSeconds: 900,
  delayBaseMs: 0,
  delayMaxMs: 30_000,
};

const key = (label: string, i: number) => `${label}${i}`.padEnd(64, '0');
const hexKey = (seed: number) => seed.toString(16).padStart(64, '0');

let db: TestDatabase;
let second: Pool;

beforeAll(async () => {
  db = await startTestDatabase();
  second = new Pool({ connectionString: db.appUrl, max: 8 });
});

afterAll(async () => {
  await second?.end();
  await db?.stop();
});

describe('bloqueos de la reserva entre conexiones', () => {
  it('el orden en que se piden las llaves no produce interbloqueos', async () => {
    const pairs = Array.from({ length: 200 }, (_, i) => {
      const account = key('a', i % 5);
      const ip = key('b', i % 3);
      return i % 2 ? [account, ip] : [ip, account];
    });
    const results = await Promise.allSettled(
      pairs.map((keys, i) =>
        withTransaction(i % 2 ? db.appPool : second, async (client) => {
          await lockThrottleKeys(client, keys);
          await client.query('SELECT pg_sleep(0.001)');
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
  });

  it('una transacción que mantiene el bloqueo de la IP detiene la reserva de otra cuenta', async () => {
    const ip = hexKey(1);
    const holder = await db.appPool.connect();
    let finished = false;
    try {
      await holder.query('BEGIN');
      await lockThrottleKeys(holder, [hexKey(2), ip]);
      const pending = withTransaction(second, (client) =>
        lockThrottleKeys(client, [hexKey(3), ip]),
      ).then(() => {
        finished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(finished).toBe(false);
      await holder.query('COMMIT');
      await pending;
      expect(finished).toBe(true);
    } finally {
      holder.release();
    }
  });

  it('comprobar y registrar es atómico: nunca se supera el límite de la IP', async () => {
    const ip = hexKey(99);
    const admitted = await Promise.all(
      Array.from({ length: 80 }, (_, i) =>
        withTransaction(i % 2 ? db.appPool : second, async (client) => {
          const account = hexKey(1_000 + i);
          await lockThrottleKeys(client, [account, ip]);
          const snapshot = await readThrottleSnapshot(client, account, ip, LIMITS.windowSeconds);
          if (!evaluateLoginThrottle(snapshot, LIMITS).allowed) return false;
          await insertLoginAttempt(client, account, ip);
          return true;
        }),
      ),
    );
    expect(admitted.filter(Boolean)).toHaveLength(LIMITS.maxFailuresPerIp);
  });
});
