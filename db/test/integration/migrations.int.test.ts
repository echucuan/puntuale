import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations, runMigrations } from '../../src/index';
import { startTestDatabase, type TestDatabase } from '../../src/testing';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db?.stop();
});

describe('migraciones', () => {
  it('aplica las migraciones y una segunda ejecución no vuelve a aplicar nada', async () => {
    const client = await db.adminPool.connect();
    try {
      const result = await runMigrations(client);
      expect(result.applied).toEqual([]);
      expect(result.skipped).toEqual(
        expect.arrayContaining(['0001', '0002', '0003', '0004', '0005']),
      );
    } finally {
      client.release();
    }
  });

  it('se detiene si una migración aplicada cambió', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'puntuale-mig-'));
    const [first] = await loadMigrations();
    if (!first) throw new Error('No hay migraciones');
    await writeFile(join(dir, `${first.version}_${first.name}.sql`), `${first.sql}\n-- editada\n`);
    const client = await db.adminPool.connect();
    try {
      await expect(runMigrations(client, dir)).rejects.toThrow(/cambió después de aplicarse/);
    } finally {
      client.release();
    }
  });

  it('0003 separa los fallos sin perder el historial de IP ni de cuenta', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'puntuale-mig-0003-'));
    for (const migration of await loadMigrations()) {
      if (migration.version > '0002') continue;
      await writeFile(join(dir, `${migration.version}_${migration.name}.sql`), migration.sql);
    }
    await db.adminPool.query('CREATE DATABASE puntuale_mig_0003');
    const url = new URL(db.adminUrl);
    url.pathname = '/puntuale_mig_0003';
    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    try {
      await runMigrations(client, dir);
      const account = 'a'.repeat(64);
      const ip = 'b'.repeat(64);
      await client.query(
        `INSERT INTO login_failure (account_key, ip_key, occurred_at)
         VALUES ($1, $2, now() - interval '5 minutes'), ($1, $2, now() - interval '1 minute')`,
        [account, ip],
      );

      const result = await runMigrations(client);
      expect(result.applied).toContain('0003');

      const accounts = await client.query(
        'SELECT 1 FROM login_failure_account WHERE account_key = $1',
        [account],
      );
      const ips = await client.query('SELECT 1 FROM login_failure_ip WHERE ip_key = $1', [ip]);
      expect([accounts.rowCount, ips.rowCount]).toEqual([2, 2]);
      const legacy = await client.query<{ name: string | null }>(
        `SELECT to_regclass('public.login_failure')::text AS name`,
      );
      expect(legacy.rows[0]!.name).toBeNull();
      const column = await client.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'login_failure_account' AND column_name = 'ip_key'`,
      );
      expect(column.rowCount).toBe(0);
    } finally {
      await client.end();
      await db.adminPool.query('DROP DATABASE puntuale_mig_0003');
    }
  });

  it('el rol de aplicación no es superusuario, no tiene BYPASSRLS y no es dueño de tablas', async () => {
    const { rows } = await db.adminPool.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      owned: string;
    }>(
      `SELECT r.rolsuper, r.rolbypassrls,
              (SELECT count(*) FROM pg_tables t WHERE t.tableowner = r.rolname)::text AS owned
         FROM pg_roles r WHERE r.rolname = 'puntuale_app'`,
    );
    expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false, owned: '0' }]);
  });

  it('el rol de aplicación no tiene DELETE ni TRUNCATE sobre ninguna tabla', async () => {
    const { rows } = await db.adminPool.query<{ table: string; privilege: string }>(
      `SELECT t.tablename AS table, p.privilege
         FROM pg_tables t
         CROSS JOIN (VALUES ('DELETE'), ('TRUNCATE')) AS p(privilege)
        WHERE t.schemaname = 'public'
          AND has_table_privilege('puntuale_app', format('public.%I', t.tablename), p.privilege)`,
    );
    expect(rows).toEqual([]);
  });

  it('todas las tablas con tenant_id tienen RLS habilitada y forzada', async () => {
    const { rows } = await db.adminPool.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE c.relkind = 'r'
          AND (EXISTS (SELECT 1 FROM pg_attribute a
                        WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
               OR c.relname = 'tenant')
          AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`,
    );
    expect(rows).toEqual([]);
  });
});
