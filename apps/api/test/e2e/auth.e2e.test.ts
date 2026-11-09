import { createHash } from 'node:crypto';
import { type INestApplication, Logger } from '@nestjs/common';
import {
  ActiveSessionsResponseSchema,
  ApiErrorSchema,
  CsrfResponseSchema,
  CurrentSessionResponseSchema,
} from '@puntuale/contracts';
import { startTestDatabase, type TestDatabase } from '@puntuale/db/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecurityConfig } from '../../src/config/app-config';
import { createApp } from '../../src/create-app';
import { seedAccount, TEST_PASSWORD, type SeededAccount } from '../support/auth';
import { testConfig, TEST_ORIGIN } from '../support/config';
import { seedTenant } from '../support/seed';

type Server = ReturnType<INestApplication['getHttpServer']>;
type Agent = ReturnType<typeof request.agent>;

let db: TestDatabase;
let app: INestApplication;

const HIGH_LOGIN_LIMITS = {
  maxFailuresPerAccount: 5,
  maxFailuresPerIp: 100_000,
  windowSeconds: 900,
  delayBaseMs: 0,
  delayMaxMs: 30_000,
};

beforeAll(async () => {
  db = await startTestDatabase();
  app = await createApp(testConfig(db.appUrl, { login: HIGH_LOGIN_LIMITS }));
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await db?.stop();
});

beforeEach(async () => {
  await db.adminPool.query('DELETE FROM login_failure_account');
  await db.adminPool.query('DELETE FROM login_failure_ip');
  await db.adminPool.query('DELETE FROM rate_limit_bucket');
});

const server = (): Server => app.getHttpServer();

async function csrfToken(agent: Agent): Promise<string> {
  const response = await agent.get('/api/auth/csrf').expect(200);
  return CsrfResponseSchema.parse(response.body).csrfToken;
}

async function postLogin(agent: Agent, email: string, password: string) {
  const token = await csrfToken(agent);
  return agent
    .post('/api/auth/login')
    .set('Origin', TEST_ORIGIN)
    .set('X-CSRF-Token', token)
    .send({ email, password });
}

async function loggedIn(account: SeededAccount, target: Server = server()) {
  const agent = request.agent(target);
  const response = await postLogin(agent, account.email, account.password);
  expect(response.status).toBe(200);
  const body = CurrentSessionResponseSchema.parse(response.body);
  const cookie = (response.headers['set-cookie'] as unknown as string[]).find((c) =>
    c.startsWith('puntuale_session='),
  )!;
  return { agent, body, cookie: cookie.split(';')[0]! };
}

function logout(agent: Agent, csrf: string) {
  return agent.post('/api/auth/logout').set('Origin', TEST_ORIGIN).set('X-CSRF-Token', csrf);
}

async function eventsOf(userId: string) {
  const { rows } = await db.adminPool.query<{
    event_type: string;
    result: string;
    failure_reason: string | null;
    request_id: string | null;
  }>(
    `SELECT event_type, result, failure_reason, request_id
       FROM security_event WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return rows;
}

describe('POST /api/auth/login', () => {
  it('crea la sesión con una cookie segura y no entrega el token en el cuerpo', async () => {
    const account = await seedAccount(db.adminPool);
    const agent = request.agent(server());
    const response = await postLogin(agent, account.email, account.password);
    expect(response.status).toBe(200);
    const body = CurrentSessionResponseSchema.parse(response.body);
    expect(body.user).toEqual({
      id: account.userId,
      email: account.email,
      displayName: expect.any(String) as string,
    });

    const cookies = response.headers['set-cookie'] as unknown as string[];
    const session = cookies.find((c) => c.startsWith('puntuale_session='))!;
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/SameSite=Lax/);
    expect(session).toMatch(/Path=\//);
    expect(session).not.toMatch(/Domain=/i);
    expect(session).not.toMatch(/Secure/);
    const token = session.split(';')[0]!.split('=')[1]!;
    expect(JSON.stringify(response.body)).not.toContain(token);
    expect(JSON.stringify(response.body)).not.toMatch(/argon2|password/i);
  });

  it('en la base solo guarda el hash del token', async () => {
    const account = await seedAccount(db.adminPool);
    const { cookie, body } = await loggedIn(account);
    const token = cookie.split('=')[1]!;
    const { rows } = await db.adminPool.query<{ token_hash: string }>(
      'SELECT token_hash FROM auth_session WHERE id = $1',
      [body.session.id],
    );
    expect(rows[0]!.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(rows[0]!.token_hash).not.toBe(token);
  });

  it('aplica 12 horas de duración absoluta y 30 minutos de inactividad', async () => {
    const { body } = await loggedIn(await seedAccount(db.adminPool));
    const created = Date.parse(body.session.createdAt);
    expect(Date.parse(body.session.expiresAt) - created).toBe(43_200_000);
    expect(Date.parse(body.session.idleExpiresAt) - created).toBe(1_800_000);
  });

  it('registra login_succeeded con su request id', async () => {
    const account = await seedAccount(db.adminPool);
    await loggedIn(account);
    const events = await eventsOf(account.userId);
    expect(events).toEqual([
      expect.objectContaining({ event_type: 'login_succeeded', result: 'success' }),
    ]);
    expect(events[0]!.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('normaliza el correo', async () => {
    const account = await seedAccount(db.adminPool);
    const agent = request.agent(server());
    const response = await postLogin(agent, `  ${account.email.toUpperCase()} `, account.password);
    expect(response.status).toBe(200);
  });

  it('responde lo mismo con contraseña incorrecta, cuenta inexistente o deshabilitada', async () => {
    const active = await seedAccount(db.adminPool);
    const disabled = await seedAccount(db.adminPool, { status: 'disabled' });
    const attempts = await Promise.all([
      postLogin(request.agent(server()), active.email, 'incorrecta'),
      postLogin(request.agent(server()), 'no.existe@example.test', TEST_PASSWORD),
      postLogin(request.agent(server()), disabled.email, TEST_PASSWORD),
    ]);
    for (const attempt of attempts) {
      expect(attempt.status).toBe(401);
      expect(ApiErrorSchema.parse(attempt.body).error.code).toBe('invalid_credentials');
      expect(attempt.body).toEqual(attempts[0]!.body);
    }
  });

  it('registra el fallo sin guardar el correo ni la contraseña', async () => {
    const email = 'identificador.secreto@example.test';
    await postLogin(request.agent(server()), email, 'contrasena-que-no-debe-guardarse');
    const { rows } = await db.adminPool.query<Record<string, unknown>>(
      `SELECT * FROM security_event WHERE failure_reason = 'unknown_or_disabled_account'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('identificador.secreto');
    expect(serialized).not.toContain('contrasena-que-no-debe-guardarse');
    expect(rows.at(-1)!['identifier_hash']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rechaza un cuerpo fuera de contrato con 422', async () => {
    const agent = request.agent(server());
    const response = await postLogin(agent, 'no-es-correo', 'x');
    expect(response.status).toBe(422);
    expect(ApiErrorSchema.parse(response.body).error.code).toBe('validation_failed');
  });
});

describe('cuerpo demasiado grande', () => {
  const SENTINEL = 'contrasena-sobredimensionada-';
  // Unos 230 KB: supera el límite de 100 KB del lector de JSON.
  const OVERSIZED = SENTINEL.repeat(8_000);
  const EXPECTED = {
    error: { code: 'payload_too_large', message: 'La solicitud es demasiado grande.' },
  };

  function postOversized(agent: Agent, csrf: string, email: string) {
    return agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ email, password: OVERSIZED });
  }

  async function securityEventsText(): Promise<string> {
    const { rows } = await db.adminPool.query('SELECT * FROM security_event');
    return JSON.stringify(rows);
  }

  async function countFor(table: 'auth_session' | 'security_event', userId: string) {
    const { rows } = await db.adminPool.query<{ count: string }>(
      `SELECT count(*) FROM ${table} WHERE user_id = $1`,
      [userId],
    );
    return Number(rows[0]!.count);
  }

  it('responde 413 con el formato estándar, sin datos sensibles y sin crear sesión', async () => {
    const account = await seedAccount(db.adminPool);
    const agent = request.agent(server());
    const token = await csrfToken(agent);
    const logged = vi.spyOn(Logger.prototype, 'error');
    let response: Awaited<ReturnType<typeof postOversized>>;
    try {
      response = await postOversized(agent, token, account.email);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }

    expect(response.status).toBe(413);
    expect(response.body).toEqual(EXPECTED);
    expect(ApiErrorSchema.safeParse(response.body).success).toBe(true);
    expect(response.text).not.toMatch(
      /contrasena|example\.test|stack|select |node_modules|argon2/i,
    );
    expect(response.text).not.toMatch(/[A-Za-z]:\\|\bat .+:\d+/);

    const cookies = (response.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
    expect(cookies.some((c) => c.startsWith('puntuale_session='))).toBe(false);
    expect(await countFor('auth_session', account.userId)).toBe(0);
    expect(await countFor('security_event', account.userId)).toBe(0);
    const { rows } = await db.adminPool.query<{ count: string }>(
      'SELECT count(*) FROM login_failure_account',
    );
    expect(rows[0]!.count).toBe('0');
    expect(await securityEventsText()).not.toContain(SENTINEL);
  });

  it('con sesión activa no la rota ni registra la contraseña o el token', async () => {
    const account = await seedAccount(db.adminPool);
    const { agent, body, cookie } = await loggedIn(account);
    const token = cookie.split('=')[1]!;

    const response = await postOversized(agent, body.csrfToken, account.email);

    expect(response.status).toBe(413);
    expect(response.body).toEqual(EXPECTED);
    expect(response.text).not.toContain(token);
    await request(server()).get('/api/auth/session').set('Cookie', cookie).expect(200);
    expect(await countFor('auth_session', account.userId)).toBe(1);
    expect((await eventsOf(account.userId)).map((e) => e.event_type)).toEqual(['login_succeeded']);
    const events = await securityEventsText();
    expect(events).not.toContain(SENTINEL);
    expect(events).not.toContain(token);
  });
});

describe('sesión, cierre y expiración', () => {
  it('GET /api/auth/session devuelve la identidad; sin cookie responde 401', async () => {
    const account = await seedAccount(db.adminPool);
    const { agent } = await loggedIn(account);
    const response = await agent.get('/api/auth/session').expect(200);
    expect(CurrentSessionResponseSchema.parse(response.body).user.id).toBe(account.userId);
    const anonymous = await request(server()).get('/api/auth/session').expect(401);
    expect(ApiErrorSchema.parse(anonymous.body).error.code).toBe('unauthenticated');
  });

  it('el logout revoca de inmediato: la misma cookie ya no sirve', async () => {
    const account = await seedAccount(db.adminPool);
    const { agent, body, cookie } = await loggedIn(account);
    await logout(agent, body.csrfToken).expect(204);
    await request(server()).get('/api/auth/session').set('Cookie', cookie).expect(401);
    expect((await eventsOf(account.userId)).map((e) => e.event_type)).toEqual([
      'login_succeeded',
      'logout',
    ]);
  });

  it('una sesión con inactividad vencida responde 401', async () => {
    const { body, cookie } = await loggedIn(await seedAccount(db.adminPool));
    await db.adminPool.query(
      `UPDATE auth_session SET idle_expires_at = now() - interval '1 second' WHERE id = $1`,
      [body.session.id],
    );
    await request(server()).get('/api/auth/session').set('Cookie', cookie).expect(401);
  });

  it('una sesión con duración absoluta vencida responde 401', async () => {
    const { body, cookie } = await loggedIn(await seedAccount(db.adminPool));
    await db.adminPool.query(
      `UPDATE auth_session SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [body.session.id],
    );
    await request(server()).get('/api/auth/session').set('Cookie', cookie).expect(401);
  });

  it('la actividad renueva la inactividad, pero nunca la expiración absoluta', async () => {
    const { body, cookie } = await loggedIn(await seedAccount(db.adminPool));
    await db.adminPool.query(
      `UPDATE auth_session
          SET last_activity_at = now() - interval '5 minutes',
              idle_expires_at = now() + interval '25 minutes'
        WHERE id = $1`,
      [body.session.id],
    );
    const response = await request(server())
      .get('/api/auth/session')
      .set('Cookie', cookie)
      .expect(200);
    const after = CurrentSessionResponseSchema.parse(response.body).session;
    expect(Date.parse(after.idleExpiresAt)).toBeGreaterThan(Date.now() + 29 * 60_000);
    expect(after.expiresAt).toBe(body.session.expiresAt);
  });

  it('deshabilitar la cuenta invalida sus sesiones', async () => {
    const account = await seedAccount(db.adminPool);
    const { cookie } = await loggedIn(account);
    await db.adminPool.query(
      `UPDATE app_user_credential SET status = 'disabled' WHERE user_id = $1`,
      [account.userId],
    );
    await request(server()).get('/api/auth/session').set('Cookie', cookie).expect(401);
  });
});

describe('rotación y revocación', () => {
  it('iniciar sesión de nuevo revoca la sesión anterior y crea otro identificador', async () => {
    const account = await seedAccount(db.adminPool);
    const { agent, body, cookie } = await loggedIn(account);
    const second = await agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .set('X-CSRF-Token', body.csrfToken)
      .send({ email: account.email, password: account.password })
      .expect(200);
    const rotated = CurrentSessionResponseSchema.parse(second.body);
    expect(rotated.session.id).not.toBe(body.session.id);
    expect(rotated.csrfToken).not.toBe(body.csrfToken);
    await request(server()).get('/api/auth/session').set('Cookie', cookie).expect(401);
    await agent.get('/api/auth/session').expect(200);

    const { rows } = await db.adminPool.query<{ revoked_reason: string }>(
      'SELECT revoked_reason FROM auth_session WHERE id = $1',
      [body.session.id],
    );
    expect(rows[0]!.revoked_reason).toBe('rotated');
    expect((await eventsOf(account.userId)).map((e) => e.event_type)).toEqual([
      'login_succeeded',
      'session_revoked',
      'login_succeeded',
    ]);
  });

  it('lista las sesiones propias y marca la actual', async () => {
    const account = await seedAccount(db.adminPool);
    const first = await loggedIn(account);
    const second = await loggedIn(account);
    const response = await second.agent.get('/api/auth/sessions').expect(200);
    const { sessions } = ActiveSessionsResponseSchema.parse(response.body);
    expect(sessions.map((s) => s.id).sort()).toEqual(
      [first.body.session.id, second.body.session.id].sort(),
    );
    expect(sessions.find((s) => s.current)?.id).toBe(second.body.session.id);
    expect(JSON.stringify(response.body)).not.toMatch(/token/i);
  });

  it('revocar otra sesión propia la invalida de inmediato', async () => {
    const account = await seedAccount(db.adminPool);
    const first = await loggedIn(account);
    const second = await loggedIn(account);
    await second.agent
      .delete(`/api/auth/sessions/${first.body.session.id}`)
      .set('Origin', TEST_ORIGIN)
      .set('X-CSRF-Token', second.body.csrfToken)
      .expect(204);
    await first.agent.get('/api/auth/session').expect(401);
    await second.agent.get('/api/auth/session').expect(200);
  });

  it('no se puede revocar la sesión de otra persona (404) y sigue activa', async () => {
    const owner = await loggedIn(await seedAccount(db.adminPool));
    const attacker = await loggedIn(await seedAccount(db.adminPool));
    const response = await attacker.agent
      .delete(`/api/auth/sessions/${owner.body.session.id}`)
      .set('Origin', TEST_ORIGIN)
      .set('X-CSRF-Token', attacker.body.csrfToken)
      .expect(404);
    expect(ApiErrorSchema.parse(response.body).error.code).toBe('not_found');
    await owner.agent.get('/api/auth/session').expect(200);
    expect((await eventsOf(attacker.body.user.id)).map((e) => e.event_type)).toEqual([
      'login_succeeded',
    ]);
    expect((await eventsOf(owner.body.user.id)).map((e) => e.event_type)).toEqual([
      'login_succeeded',
    ]);
  });

  it('el listado solo contiene las sesiones de quien pregunta', async () => {
    const owner = await loggedIn(await seedAccount(db.adminPool));
    const other = await loggedIn(await seedAccount(db.adminPool));
    const response = await other.agent.get('/api/auth/sessions').expect(200);
    const { sessions } = ActiveSessionsResponseSchema.parse(response.body);
    expect(sessions.map((s) => s.id)).toEqual([other.body.session.id]);
    expect(response.text).not.toContain(owner.body.session.id);
  });

  it('el listado ignora cualquier filtro de persona enviado por el cliente', async () => {
    const owner = await loggedIn(await seedAccount(db.adminPool));
    const other = await loggedIn(await seedAccount(db.adminPool));
    const response = await other.agent
      .get(`/api/auth/sessions?userId=${owner.body.user.id}&user_id=${owner.body.user.id}`)
      .expect(200);
    expect(response.text).not.toContain(owner.body.session.id);
  });

  it('iniciar sesión como otra persona con una cookie ajena no rota esa sesión', async () => {
    const owner = await loggedIn(await seedAccount(db.adminPool));
    const other = await seedAccount(db.adminPool);
    const response = await request(server())
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', owner.cookie)
      .set('X-CSRF-Token', owner.body.csrfToken)
      .send({ email: other.email, password: other.password })
      .expect(200);
    expect(CurrentSessionResponseSchema.parse(response.body).user.id).toBe(other.userId);

    const { rows } = await db.adminPool.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM auth_session WHERE id = $1',
      [owner.body.session.id],
    );
    expect(rows[0]!.revoked_at).toBeNull();
    await request(server()).get('/api/auth/session').set('Cookie', owner.cookie).expect(200);
    expect((await eventsOf(owner.body.user.id)).map((e) => e.event_type)).toEqual([
      'login_succeeded',
    ]);
    expect((await eventsOf(other.userId)).map((e) => e.event_type)).toEqual(['login_succeeded']);
  });

  it('un token de otra persona, recién rotado, no impide iniciar sesión', async () => {
    const owner = await loggedIn(await seedAccount(db.adminPool));
    await owner.agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .set('X-CSRF-Token', owner.body.csrfToken)
      .send({ email: owner.body.user.email, password: TEST_PASSWORD })
      .expect(200);

    const other = await seedAccount(db.adminPool);
    const anonymous = await request(server()).get('/api/auth/csrf').set('Cookie', owner.cookie);
    const nonce = (anonymous.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    await request(server())
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', `${owner.cookie}; ${nonce}`)
      .set('X-CSRF-Token', CsrfResponseSchema.parse(anonymous.body).csrfToken)
      .send({ email: other.email, password: other.password })
      .expect(200);
  });

  it('un identificador inválido responde 404', async () => {
    const { agent, body } = await loggedIn(await seedAccount(db.adminPool));
    await agent
      .delete(`/api/auth/sessions/no-es-uuid`)
      .set('Origin', TEST_ORIGIN)
      .set('X-CSRF-Token', body.csrfToken)
      .expect(404);
  });
});

describe('CSRF y origen', () => {
  it('el login sin token CSRF responde 403', async () => {
    const account = await seedAccount(db.adminPool);
    const agent = request.agent(server());
    await csrfToken(agent);
    const response = await agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: account.email, password: account.password })
      .expect(403);
    expect(ApiErrorSchema.parse(response.body).error.code).toBe('forbidden');
  });

  it('el login sin la cookie anónima responde 403 aunque el token sea válido', async () => {
    const account = await seedAccount(db.adminPool);
    const token = await csrfToken(request.agent(server()));
    await request(server())
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .set('X-CSRF-Token', token)
      .send({ email: account.email, password: account.password })
      .expect(403);
  });

  it('el logout con un token CSRF de otra sesión responde 403', async () => {
    const one = await loggedIn(await seedAccount(db.adminPool));
    const two = await loggedIn(await seedAccount(db.adminPool));
    await logout(one.agent, two.body.csrfToken).expect(403);
    await one.agent.get('/api/auth/session').expect(200);
  });

  it('rechaza un Origin desconocido, también en GET', async () => {
    const { agent, body } = await loggedIn(await seedAccount(db.adminPool));
    await agent
      .post('/api/auth/logout')
      .set('Origin', 'https://evil.test')
      .set('X-CSRF-Token', body.csrfToken)
      .expect(403);
    await agent.get('/api/auth/session').set('Origin', 'https://evil.test').expect(403);
  });

  it('sin Origin valida el Referer, y sin ninguno de los dos responde 403', async () => {
    const { agent, body } = await loggedIn(await seedAccount(db.adminPool));
    await agent.post('/api/auth/logout').set('X-CSRF-Token', body.csrfToken).expect(403);
    await agent
      .post('/api/auth/logout')
      .set('Referer', 'https://evil.test/x')
      .set('X-CSRF-Token', body.csrfToken)
      .expect(403);
    await agent
      .post('/api/auth/logout')
      .set('Referer', `${TEST_ORIGIN}/cuenta`)
      .set('X-CSRF-Token', body.csrfToken)
      .expect(204);
  });

  it('/health no exige CSRF ni origen', async () => {
    await request(server()).get('/health').set('Origin', 'https://evil.test').expect(200);
  });
});

describe('CORS y Helmet', () => {
  it('permite el origen configurado con credenciales', async () => {
    const response = await request(server())
      .options('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-csrf-token,content-type');
    expect(response.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-headers']).toMatch(/X-CSRF-Token/i);
  });

  it('un origen desconocido no recibe encabezados CORS y nunca hay comodín', async () => {
    const response = await request(server())
      .options('/api/auth/login')
      .set('Origin', 'https://evil.test')
      .set('Access-Control-Request-Method', 'POST');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    const allowed = await request(server()).get('/health').set('Origin', TEST_ORIGIN);
    expect(allowed.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('aplica las cabeceras de seguridad, también en errores', async () => {
    for (const path of ['/health', '/api/auth/session']) {
      const { headers } = await request(server()).get(path);
      expect(headers['content-security-policy']).toContain("default-src 'none'");
      expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['referrer-policy']).toBe('no-referrer');
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['x-powered-by']).toBeUndefined();
      expect(headers['strict-transport-security']).toBeUndefined();
      expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('producción activa HSTS y usa cookies __Host- con Secure, sin Domain', async () => {
    const production = await createApp(
      testConfig(db.appUrl, { corsOrigins: ['https://app.puntuale.test'] }, 'production'),
    );
    await production.init();
    try {
      const response = await request(production.getHttpServer()).get('/api/auth/csrf').expect(200);
      expect(response.headers['strict-transport-security']).toMatch(/max-age=31536000/);
      const cookie = (response.headers['set-cookie'] as unknown as string[])[0]!;
      expect(cookie).toMatch(/^__Host-puntuale_csrf=/);
      expect(cookie).toMatch(/Secure/);
      expect(cookie).toMatch(/Path=\//);
      expect(cookie).not.toMatch(/Domain=/i);
    } finally {
      await production.close();
    }
  });
});

describe('empresa activa con una sesión real', () => {
  it('una sesión con membresía accede a su empresa; a otra responde 404', async () => {
    const a = await seedTenant(db.adminPool, 'A');
    const b = await seedTenant(db.adminPool, 'B');
    const { rows } = await db.adminPool.query<{ email: string }>(
      'SELECT email FROM app_user WHERE id = $1',
      [a.userId],
    );
    const account = await seedAccount(db.adminPool, { email: rows[0]!.email, userId: a.userId });
    const { agent } = await loggedIn(account);
    await agent.get(`/api/t/${a.tenantId}/context`).expect(200);
    await agent.get(`/api/t/${b.tenantId}/context`).expect(404);
  });
});

describe('límites de tasa', () => {
  async function withLimits<T>(
    overrides: Partial<SecurityConfig>,
    work: (target: Server) => Promise<T>,
  ): Promise<T> {
    const limited = await createApp(testConfig(db.appUrl, overrides));
    await limited.init();
    try {
      return await work(limited.getHttpServer());
    } finally {
      await limited.close();
    }
  }

  it('tras 5 fallos por cuenta responde 429, incluso con la contraseña correcta', async () => {
    const account = await seedAccount(db.adminPool);
    for (let i = 0; i < 5; i += 1) {
      const attempt = await postLogin(request.agent(server()), account.email, 'incorrecta');
      expect(attempt.status).toBe(401);
    }
    const blocked = await postLogin(request.agent(server()), account.email, account.password);
    expect(blocked.status).toBe(429);
    expect(ApiErrorSchema.parse(blocked.body).error.code).toBe('rate_limited');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('una cuenta inexistente se limita igual: no revela si existe', async () => {
    const email = 'nadie.limitado@example.test';
    for (let i = 0; i < 5; i += 1) {
      await postLogin(request.agent(server()), email, 'incorrecta');
    }
    expect((await postLogin(request.agent(server()), email, 'incorrecta')).status).toBe(429);
  });

  it('el límite no es permanente: al salir de la ventana se puede entrar', async () => {
    const account = await seedAccount(db.adminPool);
    for (let i = 0; i < 5; i += 1) {
      await postLogin(request.agent(server()), account.email, 'incorrecta');
    }
    await db.adminPool.query(
      `UPDATE login_failure_account SET occurred_at = now() - interval '16 minutes'`,
    );
    expect((await postLogin(request.agent(server()), account.email, account.password)).status).toBe(
      200,
    );
  });

  it('un login exitoso borra los fallos de su cuenta', async () => {
    const account = await seedAccount(db.adminPool);
    for (let i = 0; i < 4; i += 1) {
      await postLogin(request.agent(server()), account.email, 'incorrecta');
    }
    await loggedIn(account);
    const { rows } = await db.adminPool.query<{ count: string }>(
      'SELECT count(*) FROM login_failure_account',
    );
    expect(rows[0]!.count).toBe('0');
  });

  it('peticiones concurrentes no superan el límite por cuenta', async () => {
    const account = await seedAccount(db.adminPool);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        postLogin(request.agent(server()), account.email, 'incorrecta'),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
  });

  it('aplica el límite por IP entre cuentas distintas', async () => {
    await withLimits({ login: { ...HIGH_LOGIN_LIMITS, maxFailuresPerIp: 3 } }, async (target) => {
      for (let i = 0; i < 3; i += 1) {
        const attempt = await postLogin(request.agent(target), `ip${i}@example.test`, 'mala');
        expect(attempt.status).toBe(401);
      }
      expect((await postLogin(request.agent(target), 'ip9@example.test', 'mala')).status).toBe(429);
    });
  });

  it('aplica la espera progresiva entre intentos', async () => {
    await withLimits(
      { login: { ...HIGH_LOGIN_LIMITS, delayBaseMs: 60_000, delayMaxMs: 60_000 } },
      async (target) => {
        const email = 'progresiva@example.test';
        expect((await postLogin(request.agent(target), email, 'mala')).status).toBe(401);
        const second = await postLogin(request.agent(target), email, 'mala');
        expect(second.status).toBe(429);
        expect(Number(second.headers['retry-after'])).toBeGreaterThan(50);
      },
    );
  });

  it('limita las peticiones por minuto por IP', async () => {
    await withLimits(
      { api: { perIpPerMinute: 3, perSessionPerMinute: 100_000 } },
      async (target) => {
        for (let i = 0; i < 3; i += 1) {
          await request(target).get('/api/auth/session').expect(401);
        }
        const blocked = await request(target).get('/api/auth/session').expect(429);
        expect(ApiErrorSchema.parse(blocked.body).error.code).toBe('rate_limited');
        expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
        await request(target).get('/health').expect(200);
      },
    );
  });

  it('limita las peticiones por minuto por sesión', async () => {
    const account = await seedAccount(db.adminPool);
    const { cookie } = await loggedIn(account);
    await withLimits(
      { api: { perIpPerMinute: 100_000, perSessionPerMinute: 2 } },
      async (target) => {
        await request(target).get('/api/auth/session').set('Cookie', cookie).expect(200);
        await request(target).get('/api/auth/session').set('Cookie', cookie).expect(200);
        await request(target).get('/api/auth/session').set('Cookie', cookie).expect(429);
      },
    );
  });
});
