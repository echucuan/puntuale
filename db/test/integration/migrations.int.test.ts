import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  it('aplica 0001 y una segunda ejecución no vuelve a aplicar nada', async () => {
    const client = await db.adminPool.connect();
    try {
      const result = await runMigrations(client);
      expect(result.applied).toEqual([]);
      expect(result.skipped).toContain('0001');
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
