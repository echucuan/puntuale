import { type INestApplication } from '@nestjs/common';
import {
  ApiErrorSchema,
  CsrfResponseSchema,
  CurrentSessionResponseSchema,
} from '@puntuale/contracts';
import { startTestDatabase, type TestDatabase } from '@puntuale/db/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SecurityConfig } from '../../src/config/app-config';
import { createApp } from '../../src/create-app';
import { seedAccount, type SeededAccount } from '../support/auth';
import { testConfig, TEST_ORIGIN } from '../support/config';

/**
 * Concurrencia real con dos instancias de la API (dos aplicaciones y dos pools) sobre la misma base.
 * Todas las peticiones de estas pruebas salen de la misma IP.
 */
type Server = ReturnType<INestApplication['getHttpServer']>;
type Agent = ReturnType<typeof request.agent>;
type Response = Awaited<ReturnType<typeof request.Test.prototype.send>>;
type Login = SecurityConfig['login'];

const LIMITS: Login = {
  maxFailuresPerAccount: 5,
  maxFailuresPerIp: 20,
  windowSeconds: 900,
  delayBaseMs: 0,
  delayMaxMs: 30_000,
};
const ROTATION_LIMITS: Login = { ...LIMITS, maxFailuresPerAccount: 1_000, maxFailuresPerIp: 1_000 };

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db?.stop();
});

beforeEach(async () => {
  await db.adminPool.query('DELETE FROM login_failure_account');
  await db.adminPool.query('DELETE FROM login_failure_ip');
  await db.adminPool.query('DELETE FROM rate_limit_bucket');
});

async function withInstances<T>(
  login: Login,
  work: (a: Server, b: Server) => Promise<T>,
): Promise<T> {
  const start = async () => {
    const app = await createApp(testConfig(db.appUrl, { login }));
    await app.listen(0, '127.0.0.1');
    return app;
  };
  const [first, second] = await Promise.all([start(), start()]);
  try {
    return await work(first.getHttpServer(), second.getHttpServer());
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
}

async function count(table: 'login_failure_account' | 'login_failure_ip'): Promise<number> {
  const { rows } = await db.adminPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table}`,
  );
  return rows[0]!.n;
}

function tally(statuses: number[]): Record<number, number> {
  const result: Record<number, number> = {};
  for (const status of statuses) result[status] = (result[status] ?? 0) + 1;
  return result;
}

function sessionCookies(response: Response): string[] {
  const cookies = (response.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  return cookies.filter((c) => c.startsWith('puntuale_session='));
}

/** Prepara el CSRF antes: así los POST salen realmente juntos. */
async function prepared(target: Server): Promise<{ agent: Agent; csrf: string }> {
  const agent = request.agent(target);
  const response = await agent.get('/api/auth/csrf').expect(200);
  return { agent, csrf: CsrfResponseSchema.parse(response.body).csrfToken };
}

function send(agent: Agent, csrf: string, email: string, password: string) {
  return agent
    .post('/api/auth/login')
    .set('Origin', TEST_ORIGIN)
    .set('X-CSRF-Token', csrf)
    .send({ email, password })
    .then((response) => response);
}

/** Lanza un login por cada correo, alternando instancias. */
async function burst(a: Server, b: Server, emails: string[]): Promise<Response[]> {
  const clients = await Promise.all(emails.map((_, i) => prepared(i % 2 ? b : a)));
  return Promise.all(
    emails.map((email, i) => send(clients[i]!.agent, clients[i]!.csrf, email, 'mala')),
  );
}

const distinct = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}.${i}@example.test`);

describe('límite de login por IP con dos instancias', () => {
  it.each([1, 2, 3])(
    'cuentas distintas en paralelo admiten exactamente el límite (corrida %i)',
    async (run) => {
      await withInstances(LIMITS, async (a, b) => {
        const results = await burst(a, b, distinct(`carrera${run}`, 60));
        expect(tally(results.map((r) => r.status))).toEqual({ 401: 20, 429: 40 });
        expect(await count('login_failure_ip')).toBe(20);
      });
    },
  );

  it('los reintentos siguen rechazados y al salir de la ventana se admite otra vez el límite', async () => {
    await withInstances({ ...LIMITS, maxFailuresPerIp: 6 }, async (a, b) => {
      const first = await burst(a, b, distinct('primera', 16));
      expect(tally(first.map((r) => r.status))).toEqual({ 401: 6, 429: 10 });
      for (const rejected of first.filter((r) => r.status === 429)) {
        expect(ApiErrorSchema.parse(rejected.body).error.code).toBe('rate_limited');
        expect(Number(rejected.headers['retry-after'])).toBeGreaterThan(0);
      }

      const retries = await burst(a, b, distinct('reintento', 12));
      expect(tally(retries.map((r) => r.status))).toEqual({ 429: 12 });
      expect(await count('login_failure_ip')).toBe(6);

      await db.adminPool.query(
        `UPDATE login_failure_ip SET occurred_at = now() - interval '16 minutes'`,
      );
      const after = await burst(a, b, distinct('despues', 16));
      expect(tally(after.map((r) => r.status))).toEqual({ 401: 6, 429: 10 });
    });
  });

  it('ambos límites se respetan a la vez, sin errores ni interbloqueos', async () => {
    await withInstances(
      { ...LIMITS, maxFailuresPerAccount: 3, maxFailuresPerIp: 8 },
      async (a, b) => {
        const emails = Array.from({ length: 40 }, (_, i) => `mezcla.${i % 4}@example.test`);
        const results = await burst(a, b, emails);
        expect(tally(results.map((r) => r.status))).toEqual({ 401: 8, 429: 32 });
        const perAccount = new Map<string, number>();
        results.forEach((r, i) => {
          if (r.status === 401) perAccount.set(emails[i]!, (perAccount.get(emails[i]!) ?? 0) + 1);
        });
        expect(Math.max(...perAccount.values())).toBeLessThanOrEqual(3);
      },
    );
  });

  it('la misma cuenta repartida entre instancias no supera su límite', async () => {
    await withInstances(LIMITS, async (a, b) => {
      const results = await burst(a, b, Array(12).fill('misma@example.test') as string[]);
      expect(tally(results.map((r) => r.status))).toEqual({ 401: 5, 429: 7 });
    });
  });
});

describe('un login correcto y el historial de IP', () => {
  const login = { ...LIMITS, maxFailuresPerIp: 5 };

  it('reinicia su cuenta, conserva los fallos de la IP y los siguientes intentos los cuentan', async () => {
    const account = await seedAccount(db.adminPool);
    await withInstances(login, async (a) => {
      const attempt = async (email: string, password: string) => {
        const { agent, csrf } = await prepared(a);
        return send(agent, csrf, email, password);
      };
      expect((await attempt(account.email, 'mala')).status).toBe(401);
      expect((await attempt(account.email, 'mala')).status).toBe(401);
      expect((await attempt('otra@example.test', 'mala')).status).toBe(401);
      expect(await count('login_failure_ip')).toBe(3);
      expect(await count('login_failure_account')).toBe(3);

      expect((await attempt(account.email, account.password)).status).toBe(200);
      expect(await count('login_failure_ip')).toBe(3);
      expect(await count('login_failure_account')).toBe(1);

      expect((await attempt('nueva1@example.test', 'mala')).status).toBe(401);
      expect((await attempt('nueva2@example.test', 'mala')).status).toBe(401);
      expect((await attempt('nueva3@example.test', 'mala')).status).toBe(429);
      expect((await attempt(account.email, account.password)).status).toBe(429);
    });
  });

  it('los logins correctos no consumen el límite de la IP', async () => {
    const account = await seedAccount(db.adminPool);
    await withInstances(login, async (a, b) => {
      for (let i = 0; i < 8; i += 1) {
        const { agent, csrf } = await prepared(i % 2 ? b : a);
        expect((await send(agent, csrf, account.email, account.password)).status).toBe(200);
      }
      expect(await count('login_failure_ip')).toBe(0);
    });
  });
});

describe('rotación concurrente', () => {
  interface Signed {
    account: SeededAccount;
    sessionId: string;
    csrf: string;
    cookie: string;
  }

  async function signedIn(target: Server): Promise<Signed> {
    const account = await seedAccount(db.adminPool);
    const { agent, csrf } = await prepared(target);
    const response = await send(agent, csrf, account.email, account.password);
    expect(response.status).toBe(200);
    const body = CurrentSessionResponseSchema.parse(response.body);
    return {
      account,
      sessionId: body.session.id,
      csrf: body.csrfToken,
      cookie: sessionCookies(response)[0]!.split(';')[0]!,
    };
  }

  function rotate(target: Server, signed: Signed) {
    return request(target)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', signed.cookie)
      .set('X-CSRF-Token', signed.csrf)
      .send({ email: signed.account.email, password: signed.account.password })
      .then((response) => response);
  }

  async function sessionsOf(userId: string) {
    const { rows } = await db.adminPool.query<{
      id: string;
      active: boolean;
      reason: string | null;
    }>(
      `SELECT id, revoked_at IS NULL AS active, revoked_reason AS reason
         FROM auth_session WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    );
    return rows;
  }

  async function eventsOf(userId: string) {
    const { rows } = await db.adminPool.query<{ event_type: string; reason: string | null }>(
      `SELECT event_type, failure_reason AS reason FROM security_event WHERE user_id = $1 ORDER BY id`,
      [userId],
    );
    return rows;
  }

  async function waitForBlockedRotations(expected: number): Promise<void> {
    for (let i = 0; i < 400; i += 1) {
      const { rows } = await db.adminPool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE '%FROM auth_session%FOR UPDATE%'
            AND pid <> pg_backend_pid()`,
      );
      if (rows[0]!.n >= expected) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Las rotaciones no llegaron a esperar el bloqueo');
  }

  it('dos peticiones ya dentro de la rotación: gana una y la otra no crea sesión ni cookie', async () => {
    await withInstances(ROTATION_LIMITS, async (a, b) => {
      const signed = await signedIn(a);
      const holder = await db.adminPool.connect();
      let results: Response[];
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT 1 FROM auth_session WHERE id = $1 FOR UPDATE', [
          signed.sessionId,
        ]);
        const pending = Promise.all([rotate(a, signed), rotate(b, signed)]);
        await waitForBlockedRotations(2);
        await holder.query('COMMIT');
        results = await pending;
      } finally {
        holder.release();
      }

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const winner = results.find((r) => r.status === 200)!;
      const loser = results.find((r) => r.status === 409)!;
      expect(ApiErrorSchema.parse(loser.body).error.code).toBe('conflict');
      expect(sessionCookies(loser)).toEqual([]);
      expect(sessionCookies(winner)).toHaveLength(1);

      const sessions = await sessionsOf(signed.account.userId);
      expect(sessions).toHaveLength(2);
      expect(sessions[0]).toMatchObject({ active: false, reason: 'rotated' });
      expect(sessions[1]).toMatchObject({ active: true, reason: null });

      const cookie = sessionCookies(winner)[0]!.split(';')[0]!;
      await request(a).get('/api/auth/session').set('Cookie', cookie).expect(200);
      await request(b).get('/api/auth/session').set('Cookie', signed.cookie).expect(401);

      expect(await count('login_failure_ip')).toBe(0);
      expect(await count('login_failure_account')).toBe(0);
      const events = await eventsOf(signed.account.userId);
      expect(events.filter((e) => e.event_type === 'session_revoked')).toHaveLength(1);
      expect(events.filter((e) => e.reason === 'session_rotation_conflict')).toHaveLength(1);
    });
  });

  it.each([1, 2, 3])(
    'en paralelo entre instancias, una sola rotación crea sesión (corrida %i)',
    async () => {
      await withInstances(ROTATION_LIMITS, async (a, b) => {
        const signed = await signedIn(a);
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, i) => rotate(i % 2 ? b : a, signed)),
        );
        const statuses = results.map((r) => r.status);
        expect(statuses.filter((s) => s === 200)).toHaveLength(1);
        // Según el momento, la perdedora cae en la rotación (409) o en el CSRF ligado a la sesión (403).
        expect(statuses.every((s) => [200, 403, 409].includes(s))).toBe(true);
        expect(results.flatMap(sessionCookies)).toHaveLength(1);

        const sessions = await sessionsOf(signed.account.userId);
        expect(sessions.filter((s) => s.active)).toHaveLength(1);
        expect(sessions).toHaveLength(2);
      });
    },
  );

  it('una cookie recién rotada responde 409 y, pasado el plazo, permite un login nuevo', async () => {
    await withInstances(ROTATION_LIMITS, async (a) => {
      const signed = await signedIn(a);
      expect((await rotate(a, signed)).status).toBe(200);

      const anonymous = await request(a).get('/api/auth/csrf').set('Cookie', signed.cookie);
      const csrfCookie = (anonymous.headers['set-cookie'] as unknown as string[])[0]!.split(
        ';',
      )[0]!;
      const csrf = CsrfResponseSchema.parse(anonymous.body).csrfToken;
      const stale = () =>
        request(a)
          .post('/api/auth/login')
          .set('Origin', TEST_ORIGIN)
          .set('Cookie', `${signed.cookie}; ${csrfCookie}`)
          .set('X-CSRF-Token', csrf)
          .send({ email: signed.account.email, password: signed.account.password })
          .then((response) => response);

      const conflict = await stale();
      expect(conflict.status).toBe(409);
      expect(sessionCookies(conflict)).toEqual([]);
      expect(await sessionsOf(signed.account.userId)).toHaveLength(2);

      // El token CSRF ligado a la sesión consumida ya no sirve.
      const withOldCsrf = await rotate(a, signed);
      expect(withOldCsrf.status).toBe(403);
      expect(sessionCookies(withOldCsrf)).toEqual([]);

      await db.adminPool.query(
        `UPDATE auth_session SET revoked_at = now() - interval '31 seconds' WHERE id = $1`,
        [signed.sessionId],
      );
      const later = await stale();
      expect(later.status).toBe(200);
      expect(sessionCookies(later)).toHaveLength(1);
      const sessions = await sessionsOf(signed.account.userId);
      expect(sessions.filter((s) => s.active)).toHaveLength(2);
    });
  });

  it('otros dispositivos inician sesión de forma independiente, también en paralelo', async () => {
    await withInstances(ROTATION_LIMITS, async (a, b) => {
      const signed = await signedIn(a);
      const devices = await Promise.all([prepared(a), prepared(b), prepared(a), prepared(b)]);
      const results = await Promise.all(
        devices.map(({ agent, csrf }) =>
          send(agent, csrf, signed.account.email, signed.account.password),
        ),
      );
      expect(tally(results.map((r) => r.status))).toEqual({ 200: 4 });
      const sessions = await sessionsOf(signed.account.userId);
      expect(sessions.filter((s) => s.active)).toHaveLength(5);
      await request(a).get('/api/auth/session').set('Cookie', signed.cookie).expect(200);
    });
  });
});
