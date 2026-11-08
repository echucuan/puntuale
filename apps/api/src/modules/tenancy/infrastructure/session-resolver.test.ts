import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../config/app-config';
import { NoSessionResolver } from './no-session.resolver';
import { createSessionResolver } from './session-resolver.provider';
import { TEST_SESSION_HEADER, TestSessionResolver } from './test-session.resolver';

const USER = '0190F5E2-0000-7000-8000-0000000000BB';

function config(nodeEnv: AppConfig['nodeEnv']): AppConfig {
  return { nodeEnv, port: 0, databaseUrl: 'postgres://u:ficticia@localhost/db' };
}

describe('resolvedores de sesión (ADR 0007)', () => {
  it('en desarrollo y producción se usa NoSessionResolver, que nunca da sesión', async () => {
    for (const env of ['development', 'production'] as const) {
      const resolver = createSessionResolver(config(env));
      expect(resolver).toBeInstanceOf(NoSessionResolver);
      await expect(
        resolver.resolve({ headers: { [TEST_SESSION_HEADER]: USER } }),
      ).resolves.toBeNull();
    }
  });

  it('solo con NODE_ENV=test se usa TestSessionResolver', () => {
    expect(createSessionResolver(config('test'))).toBeInstanceOf(TestSessionResolver);
  });

  it('TestSessionResolver no se puede construir fuera de NODE_ENV=test', () => {
    expect(() => new TestSessionResolver('development')).toThrow(/NODE_ENV=test/);
    expect(() => new TestSessionResolver('production')).toThrow(/NODE_ENV=test/);
    expect(() => new TestSessionResolver(undefined)).toThrow(/NODE_ENV=test/);
  });

  it('TestSessionResolver acepta solo un UUID en el encabezado', async () => {
    const resolver = new TestSessionResolver('test');
    await expect(resolver.resolve({ headers: { [TEST_SESSION_HEADER]: USER } })).resolves.toEqual({
      userId: USER.toLowerCase(),
    });
    await expect(resolver.resolve({ headers: {} })).resolves.toBeNull();
    await expect(
      resolver.resolve({ headers: { [TEST_SESSION_HEADER]: 'admin' } }),
    ).resolves.toBeNull();
    await expect(
      resolver.resolve({ headers: { [TEST_SESSION_HEADER]: [USER, USER] } }),
    ).resolves.toBeNull();
  });
});
