import { describe, expect, it } from 'vitest';
import { cookieNames, readCookie } from './auth-cookies';
import { generateCsrfNonce, issueCsrfToken, verifyCsrfToken } from './csrf';
import { keyedHash, safeEqual } from './keyed-hash';
import {
  evaluateLoginThrottle,
  type LoginThrottleLimits,
  type LoginThrottleSnapshot,
  progressiveDelaySeconds,
} from './login-throttle';
import { isOriginAllowed, isSafeMethod } from './origin-policy';
import { generateSessionToken, hashSessionToken } from './session-token';

const SECRET = 's'.repeat(40);

describe('token de sesión', () => {
  it('genera 256 bits distintos en cada llamada', () => {
    const token = generateSessionToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(generateSessionToken()).not.toBe(token);
  });

  it('el hash es SHA-256 en hexadecimal y no contiene el token', () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });
});

describe('hash con llave', () => {
  it('separa por propósito y por secreto', () => {
    const base = keyedHash(SECRET, 'a', 'valor');
    expect(keyedHash(SECRET, 'b', 'valor')).not.toBe(base);
    expect(keyedHash(`${SECRET}x`, 'a', 'valor')).not.toBe(base);
  });

  it('safeEqual compara longitudes distintas sin fallar', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('token CSRF', () => {
  const session = { kind: 'session', sessionId: 's1' } as const;

  it('verifica el token de su propia vinculación', () => {
    expect(verifyCsrfToken(SECRET, session, issueCsrfToken(SECRET, session))).toBe(true);
  });

  it('rechaza el token de otra sesión o de otro secreto', () => {
    const other = issueCsrfToken(SECRET, { kind: 'session', sessionId: 's2' });
    expect(verifyCsrfToken(SECRET, session, other)).toBe(false);
    expect(verifyCsrfToken(`${SECRET}x`, session, issueCsrfToken(SECRET, session))).toBe(false);
  });

  it('un token anónimo no sirve como token de sesión', () => {
    const nonce = 's1';
    const anonymous = issueCsrfToken(SECRET, { kind: 'anonymous', nonce });
    expect(verifyCsrfToken(SECRET, session, anonymous)).toBe(false);
  });

  it('genera valores anónimos distintos', () => {
    expect(generateCsrfNonce()).not.toBe(generateCsrfNonce());
  });
});

describe('política de origen', () => {
  const allowed = new Set(['http://localhost:5173']);
  const check = (method: string, origin?: string, referer?: string) =>
    isOriginAllowed({ method, origin, referer, allowed });

  it('reconoce los métodos seguros', () => {
    expect(isSafeMethod('get')).toBe(true);
    expect(isSafeMethod('POST')).toBe(false);
  });

  it('acepta un Origin permitido y rechaza uno desconocido en cualquier método', () => {
    expect(check('POST', 'http://localhost:5173')).toBe(true);
    expect(check('POST', 'https://evil.test')).toBe(false);
    expect(check('GET', 'https://evil.test')).toBe(false);
  });

  it('un Origin desconocido no se compensa con un Referer válido', () => {
    expect(check('POST', 'https://evil.test', 'http://localhost:5173/login')).toBe(false);
  });

  it('sin Origin, un método mutable valida el Referer', () => {
    expect(check('POST', undefined, 'http://localhost:5173/login')).toBe(true);
    expect(check('POST', undefined, 'https://evil.test/x')).toBe(false);
    expect(check('POST', undefined, 'no-es-url')).toBe(false);
  });

  it('un método mutable sin Origin ni Referer se rechaza; uno seguro se permite', () => {
    expect(check('DELETE')).toBe(false);
    expect(check('GET')).toBe(true);
  });
});

describe('límites de login', () => {
  const limits: LoginThrottleLimits = {
    maxFailuresPerAccount: 5,
    maxFailuresPerIp: 20,
    windowSeconds: 900,
    delayBaseMs: 1000,
    delayMaxMs: 30_000,
  };
  const empty: LoginThrottleSnapshot = {
    accountFailures: 0,
    ipFailures: 0,
    oldestAccountAgeSeconds: null,
    newestAccountAgeSeconds: null,
    oldestIpAgeSeconds: null,
  };

  it('la espera crece 1, 2, 4… hasta el máximo', () => {
    expect([1, 2, 3, 4].map((n) => progressiveDelaySeconds(n, limits))).toEqual([1, 2, 4, 8]);
    expect(progressiveDelaySeconds(20, limits)).toBe(30);
    expect(progressiveDelaySeconds(0, limits)).toBe(0);
    expect(progressiveDelaySeconds(3, { delayBaseMs: 0, delayMaxMs: 30_000 })).toBe(0);
  });

  it('sin fallos admite el intento', () => {
    expect(evaluateLoginThrottle(empty, limits)).toEqual({ allowed: true });
  });

  it('aplica la espera progresiva y la libera al cumplirse', () => {
    const snapshot = {
      ...empty,
      accountFailures: 3,
      oldestAccountAgeSeconds: 10,
      newestAccountAgeSeconds: 1,
    };
    expect(evaluateLoginThrottle(snapshot, limits)).toEqual({
      allowed: false,
      retryAfterSeconds: 3,
    });
    expect(evaluateLoginThrottle({ ...snapshot, newestAccountAgeSeconds: 4 }, limits)).toEqual({
      allowed: true,
    });
  });

  it('el límite por cuenta dura hasta que el fallo más viejo sale de la ventana', () => {
    const snapshot = {
      ...empty,
      accountFailures: 5,
      oldestAccountAgeSeconds: 600,
      newestAccountAgeSeconds: 500,
    };
    expect(evaluateLoginThrottle(snapshot, limits)).toEqual({
      allowed: false,
      retryAfterSeconds: 300,
    });
  });

  it('aplica el límite por IP aunque la cuenta no tenga fallos', () => {
    expect(
      evaluateLoginThrottle({ ...empty, ipFailures: 20, oldestIpAgeSeconds: 100 }, limits),
    ).toEqual({ allowed: false, retryAfterSeconds: 800 });
  });
});

describe('cookies', () => {
  it('usa __Host- solo en producción', () => {
    expect(cookieNames('production').session).toBe('__Host-puntuale_session');
    expect(cookieNames('development').session).toBe('puntuale_session');
    expect(cookieNames('test').csrf).toBe('puntuale_csrf');
  });

  it('lee una cookie y gana la primera si se repite', () => {
    expect(readCookie('a=1; b=2; a=3', 'a')).toBe('1');
    expect(readCookie('a=1; b=2', 'b')).toBe('2');
  });

  it('devuelve null si no existe o está vacía', () => {
    expect(readCookie(undefined, 'a')).toBeNull();
    expect(readCookie('b=2', 'a')).toBeNull();
    expect(readCookie('a=', 'a')).toBeNull();
    expect(readCookie('ab=1', 'a')).toBeNull();
  });
});
