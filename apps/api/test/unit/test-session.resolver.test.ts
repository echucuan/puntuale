import { describe, expect, it } from 'vitest';
import {
  TEST_COMPOSITION_MARKER,
  TEST_SESSION_HEADER,
  TestSessionResolver,
} from '../support/test-session.resolver';

const USER = '0190F5E2-0000-7000-8000-0000000000BB';
const LOCAL_DB = 'postgres://u:ficticia@localhost:5432/db';
const explicitEnv = {
  NODE_ENV: 'test',
  VITEST: 'true',
  PUNTUALE_TEST_COMPOSITION: TEST_COMPOSITION_MARKER,
};

describe('TestSessionResolver: exige un entorno de pruebas explícito', () => {
  it('se construye solo si se cumplen todas las condiciones', () => {
    expect(
      () => new TestSessionResolver({ env: explicitEnv, databaseUrl: LOCAL_DB }),
    ).not.toThrow();
  });

  it('NODE_ENV=test por sí solo no basta', () => {
    expect(
      () => new TestSessionResolver({ env: { NODE_ENV: 'test' }, databaseUrl: LOCAL_DB }),
    ).toThrow(/Vitest.*marca de composición/);
  });

  it.each([
    ['development', { ...explicitEnv, NODE_ENV: 'development' }],
    ['production', { ...explicitEnv, NODE_ENV: 'production' }],
    ['sin Vitest', { ...explicitEnv, VITEST: undefined }],
    ['sin marca de composición', { ...explicitEnv, PUNTUALE_TEST_COMPOSITION: undefined }],
    ['marca incorrecta', { ...explicitEnv, PUNTUALE_TEST_COMPOSITION: 'true' }],
  ])('se rechaza: %s', (_case, env) => {
    expect(() => new TestSessionResolver({ env, databaseUrl: LOCAL_DB })).toThrow(
      /no puede usarse aquí/,
    );
  });

  it('se rechaza si la base de datos no es local', () => {
    expect(
      () =>
        new TestSessionResolver({
          env: explicitEnv,
          databaseUrl: 'postgres://u:ficticia@db.produccion.example.com:5432/puntuale',
        }),
    ).toThrow(/la base no es local/);
  });

  it('acepta solo un UUID en el encabezado', async () => {
    const resolver = new TestSessionResolver({ env: explicitEnv, databaseUrl: LOCAL_DB });
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
