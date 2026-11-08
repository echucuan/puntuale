import { describe, expect, it } from 'vitest';
import { loadConfig } from './app-config';

const valid = {
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: 'postgres://puntuale_app:ficticia@localhost:5432/puntuale',
};

describe('loadConfig', () => {
  it('acepta una configuración válida y convierte el puerto', () => {
    expect(loadConfig(valid)).toEqual({
      nodeEnv: 'development',
      port: 3000,
      databaseUrl: valid.DATABASE_URL,
    });
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
