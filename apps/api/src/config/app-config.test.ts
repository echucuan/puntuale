import { describe, expect, it } from 'vitest';
import { loadConfig } from './app-config';

const valid = {
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: 'postgres://puntuale_app:ficticia@localhost:5432/puntuale',
  AUTH_SECRET: 'secreto_ficticio_dev_only_0123456789',
  MFA_ENCRYPTION_KEY: 'llave_mfa_ficticia_dev_only_0123456789',
  CORS_ORIGINS: 'http://localhost:5173',
};

const production = {
  ...valid,
  NODE_ENV: 'production',
  AUTH_SECRET: 'p'.repeat(40),
  MFA_ENCRYPTION_KEY: 'm'.repeat(40),
  CORS_ORIGINS: 'https://app.puntuale.test',
};

describe('loadConfig', () => {
  it('exige la llave MFA y la rechaza en producción si es ficticia o repite AUTH_SECRET', () => {
    const withoutKey: Record<string, string> = { ...valid };
    delete withoutKey['MFA_ENCRYPTION_KEY'];
    expect(() => loadConfig(withoutKey)).toThrow('MFA_ENCRYPTION_KEY');
    expect(() =>
      loadConfig({ ...production, MFA_ENCRYPTION_KEY: 'x_dev_only_'.repeat(4) }),
    ).toThrow('MFA_ENCRYPTION_KEY');
    expect(() => loadConfig({ ...production, MFA_ENCRYPTION_KEY: production.AUTH_SECRET })).toThrow(
      'MFA_ENCRYPTION_KEY',
    );
  });

  it('acepta una configuración válida y convierte el puerto', () => {
    expect(loadConfig(valid)).toMatchObject({
      nodeEnv: 'development',
      port: 3000,
      databaseUrl: valid.DATABASE_URL,
    });
  });

  it('aplica los valores por defecto del ADR 0014', () => {
    expect(loadConfig(valid).security).toMatchObject({
      corsOrigins: ['http://localhost:5173'],
      session: { absoluteTtlSeconds: 43_200, idleTtlSeconds: 1_800 },
      login: { maxFailuresPerAccount: 5, maxFailuresPerIp: 20, windowSeconds: 900 },
      api: { perIpPerMinute: 120, perSessionPerMinute: 300 },
    });
  });

  it('exige AUTH_SECRET de al menos 32 caracteres', () => {
    expect(() => loadConfig({ ...valid, AUTH_SECRET: 'corto' })).toThrow(/AUTH_SECRET/);
  });

  it('producción rechaza el secreto ficticio', () => {
    expect(() => loadConfig({ ...production, AUTH_SECRET: valid.AUTH_SECRET })).toThrow(
      /AUTH_SECRET/,
    );
    expect(loadConfig(production).nodeEnv).toBe('production');
  });

  it('producción exige https y rechaza localhost', () => {
    for (const CORS_ORIGINS of ['http://app.puntuale.test', 'https://localhost:5173']) {
      expect(() => loadConfig({ ...production, CORS_ORIGINS })).toThrow(/CORS_ORIGINS/);
    }
  });

  it('fuera de producción solo admite localhost', () => {
    expect(() => loadConfig({ ...valid, CORS_ORIGINS: 'https://app.puntuale.test' })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it('rechaza un comodín o un origen con ruta', () => {
    for (const CORS_ORIGINS of ['*', 'http://localhost:5173/app']) {
      expect(() => loadConfig({ ...valid, CORS_ORIGINS })).toThrow(/CORS_ORIGINS/);
    }
  });

  it('rechaza un NODE_ENV desconocido', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rechaza una URL que no es de PostgreSQL y no revela su valor', () => {
    const secret = 'mysql://u:contrasena-secreta@h/db';
    expect(() => loadConfig({ ...valid, DATABASE_URL: secret })).toThrow(/DATABASE_URL/);
    try {
      loadConfig({ ...valid, DATABASE_URL: secret });
    } catch (error) {
      expect(String(error)).not.toContain('contrasena-secreta');
    }
  });
});
