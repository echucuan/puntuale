import { describe, expect, it } from 'vitest';
import { authFailureMessage, createAuthApi, formatWait, toFormFeedback } from './auth';

const SESSION = {
  user: {
    id: '0190f5e2-0000-7000-8000-0000000000aa',
    email: 'ana.demo@puntuale.test',
    displayName: 'Ana',
  },
  session: {
    id: '0190f5e2-0000-7000-8000-0000000000bb',
    createdAt: '2026-11-08T18:00:00.000Z',
    lastActivityAt: '2026-11-08T18:00:00.000Z',
    idleExpiresAt: '2026-11-08T18:30:00.000Z',
    expiresAt: '2026-11-09T06:00:00.000Z',
  },
  csrfToken: 'token-de-sesion',
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function recording(handler: (path: string, init: RequestInit) => Response) {
  const calls: { path: string; init: RequestInit }[] = [];
  const fetchImpl = ((path: string, init: RequestInit = {}) => {
    calls.push({ path, init });
    return Promise.resolve(handler(path, init));
  }) as unknown as typeof fetch;
  return { calls, api: createAuthApi(fetchImpl) };
}

describe('createAuthApi', () => {
  it('login pide el token CSRF y lo envía en el encabezado', async () => {
    const { api, calls } = recording((path) =>
      path === '/api/auth/csrf' ? json(200, { csrfToken: 'abc' }) : json(200, SESSION),
    );
    const result = await api.login({ email: 'ana.demo@puntuale.test', password: 'x' });
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.path)).toEqual(['/api/auth/csrf', '/api/auth/login']);
    expect(calls[1]!.init.headers).toMatchObject({ 'X-CSRF-Token': 'abc' });
  });

  it('un 429 conserva Retry-After', async () => {
    const { api } = recording((path) =>
      path === '/api/auth/csrf'
        ? json(200, { csrfToken: 'abc' })
        : json(429, { error: { code: 'rate_limited', message: 'x' } }, { 'Retry-After': '30' }),
    );
    expect(await api.login({ email: 'a@b.test', password: 'x' })).toEqual({
      ok: false,
      failure: { code: 'rate_limited', retryAfterSeconds: 30 },
    });
  });

  it('una respuesta fuera de contrato no se acepta como sesión', async () => {
    const { api } = recording(() => json(200, { user: 'x' }));
    expect(await api.currentSession()).toEqual({
      ok: false,
      failure: { code: 'unexpected', retryAfterSeconds: null },
    });
  });

  it('si falla el token CSRF no envía la mutación', async () => {
    const { api, calls } = recording(() => json(500, {}));
    expect((await api.logout()).ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('un fallo de red se reporta como inalcanzable', async () => {
    const failing = (() => Promise.reject(new Error('sin red'))) as unknown as typeof fetch;
    expect(await createAuthApi(failing).currentSession()).toEqual({
      ok: false,
      failure: { code: 'unreachable', retryAfterSeconds: null },
    });
  });
});

describe('toFormFeedback', () => {
  it('convierte el límite con Retry-After en una espera', () => {
    expect(toFormFeedback({ code: 'rate_limited', retryAfterSeconds: 12 })).toMatchObject({
      kind: 'wait',
      retryAfterSeconds: 12,
    });
  });

  it('sin Retry-After muestra un error, porque no hay plazo que contar', () => {
    expect(toFormFeedback({ code: 'rate_limited', retryAfterSeconds: null }).kind).toBe('error');
  });

  it('muestra un mensaje específico para un cuerpo demasiado grande', () => {
    expect(toFormFeedback({ code: 'payload_too_large', retryAfterSeconds: null })).toEqual({
      kind: 'error',
      message: 'Los datos enviados son demasiado grandes. Revísalos e inténtalo de nuevo.',
    });
  });
});

describe('formatWait', () => {
  it.each([
    [45, '45 s'],
    [60, '1 min'],
    [125, '2 min 5 s'],
  ])('%i segundos se muestran como %s', (seconds, expected) => {
    expect(formatWait(seconds)).toBe(expected);
  });
});

describe('authFailureMessage', () => {
  it('explica el conflicto de una sesión ya renovada', () => {
    expect(authFailureMessage({ code: 'conflict', retryAfterSeconds: null })).toContain('renovó');
  });

  it('incluye la espera cuando existe', () => {
    expect(authFailureMessage({ code: 'rate_limited', retryAfterSeconds: 8 })).toContain('8 s');
  });

  it('no revela si la cuenta existe', () => {
    expect(authFailureMessage({ code: 'invalid_credentials', retryAfterSeconds: null })).toBe(
      'Correo o contraseña incorrectos.',
    );
  });
});
