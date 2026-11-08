import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '../../src/testing';

const TOKEN_HASH = 'a'.repeat(64);
const FUNCTIONS = [
  'auth_find_account(text)',
  'auth_session_identity(text)',
  'auth_clear_login_failures(text)',
  'auth_purge_throttle()',
];

let db: TestDatabase;
let userId: string;
const argonHash = '$argon2id$v=19$m=65536,t=3,p=1$ZmljdGljaW8$ZmljdGljaW8';

beforeAll(async () => {
  db = await startTestDatabase();
  const { rows } = await db.adminPool.query<{ id: string }>(
    `INSERT INTO app_user (email, display_name)
     VALUES ('Persona@Example.test', 'Persona') RETURNING id`,
  );
  userId = rows[0]!.id;
  await db.adminPool.query(
    `INSERT INTO app_user_credential (user_id, password_hash) VALUES ($1, $2)`,
    [userId, argonHash],
  );
  await db.adminPool.query(
    `INSERT INTO auth_session (user_id, token_hash, idle_expires_at, expires_at)
     VALUES ($1, $2, now() + interval '30 minutes', now() + interval '12 hours')`,
    [userId, TOKEN_HASH],
  );
});

afterAll(async () => {
  await db?.stop();
});

describe('funciones SECURITY DEFINER (ADR 0014)', () => {
  it.each(FUNCTIONS)('%s es SECURITY DEFINER con search_path fijo', async (signature) => {
    const { rows } = await db.adminPool.query<{ prosecdef: boolean; proconfig: string[] }>(
      `SELECT prosecdef, proconfig FROM pg_proc WHERE oid = $1::regprocedure`,
      [signature],
    );
    expect(rows[0]!.prosecdef).toBe(true);
    expect(rows[0]!.proconfig).toEqual(['search_path=pg_catalog, public, pg_temp']);
  });

  it.each(FUNCTIONS)('%s solo la ejecuta puntuale_app', async (signature) => {
    const { rows } = await db.adminPool.query<{ app: boolean; public_role: boolean }>(
      `SELECT has_function_privilege('puntuale_app', $1::regprocedure, 'EXECUTE') AS app,
              EXISTS (
                SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                 WHERE p.oid = $1::regprocedure AND a.grantee = 0
              ) AS public_role`,
      [signature],
    );
    expect(rows[0]).toEqual({ app: true, public_role: false });
  });

  it('el dueño no es superusuario, no inicia sesión y no tiene BYPASSRLS', async () => {
    const { rows } = await db.adminPool.query<{
      rolname: string;
      rolsuper: boolean;
      rolcanlogin: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT DISTINCT r.rolname, r.rolsuper, r.rolcanlogin, r.rolbypassrls
         FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
        WHERE p.proname LIKE 'auth\\_%'`,
    );
    expect(rows).toEqual([
      {
        rolname: 'puntuale_auth_definer',
        rolsuper: false,
        rolcanlogin: false,
        rolbypassrls: false,
      },
    ]);
  });

  it('auth_find_account devuelve solo los campos necesarios y no distingue mayúsculas', async () => {
    const { rows, fields } = await db.appPool.query(
      `SELECT * FROM auth_find_account('persona@example.test')`,
    );
    expect(fields.map((f) => f.name)).toEqual(['user_id', 'password_hash']);
    expect(rows).toEqual([{ user_id: userId, password_hash: argonHash }]);
  });

  it('auth_find_account no devuelve filas si la cuenta no existe', async () => {
    const { rows } = await db.appPool.query(
      `SELECT * FROM auth_find_account('nadie@example.test')`,
    );
    expect(rows).toEqual([]);
  });

  it('auth_session_identity solo responde con el hash de una sesión activa', async () => {
    const active = await db.appPool.query('SELECT * FROM auth_session_identity($1)', [TOKEN_HASH]);
    expect(active.rows[0]).toMatchObject({ user_id: userId, email: 'Persona@Example.test' });
    const unknown = await db.appPool.query('SELECT * FROM auth_session_identity($1)', [
      'b'.repeat(64),
    ]);
    expect(unknown.rows).toEqual([]);
  });

  it('un rol sin permisos no puede ejecutar las funciones', async () => {
    await db.adminPool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'puntuale_sin_permisos') THEN
        CREATE ROLE puntuale_sin_permisos NOLOGIN;
      END IF;
    END $$`);
    await db.adminPool.query('GRANT USAGE ON SCHEMA public TO puntuale_sin_permisos');
    const client = await db.adminPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE puntuale_sin_permisos');
      await expect(
        client.query(`SELECT * FROM auth_find_account('persona@example.test')`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe('permisos de puntuale_app', () => {
  it('no puede leer app_user ni las credenciales', async () => {
    await expect(db.appPool.query('SELECT email FROM app_user')).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.appPool.query('SELECT * FROM app_user_credential')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('no puede cambiar el token, la persona ni la expiración absoluta de una sesión', async () => {
    for (const column of ['token_hash', 'user_id', 'expires_at']) {
      await expect(
        db.appPool.query(`UPDATE auth_session SET ${column} = ${column}`),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('no puede leer security_event', async () => {
    await expect(db.appPool.query('SELECT * FROM security_event')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('no puede borrar filas de las tablas de límites', async () => {
    for (const table of ['login_failure', 'rate_limit_bucket', 'auth_session']) {
      await expect(db.appPool.query(`DELETE FROM ${table}`)).rejects.toThrow(/permission denied/);
    }
  });
});

describe('security_event es de solo inserción', () => {
  beforeAll(async () => {
    await db.appPool.query(
      `INSERT INTO security_event (event_type, result, user_id)
       VALUES ('login_succeeded', 'success', $1)`,
      [userId],
    );
  });

  it('puntuale_app no puede actualizar ni borrar', async () => {
    await expect(db.appPool.query(`UPDATE security_event SET result = 'failure'`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.appPool.query('DELETE FROM security_event')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('el trigger rechaza UPDATE, DELETE y TRUNCATE de la conexión administrativa', async () => {
    await expect(
      db.adminPool.query(`UPDATE security_event SET failure_reason = 'x'`),
    ).rejects.toThrow(/solo acepta inserciones/);
    await expect(db.adminPool.query('DELETE FROM security_event')).rejects.toThrow(
      /solo acepta inserciones/,
    );
    await expect(db.adminPool.query('TRUNCATE security_event')).rejects.toThrow(
      /solo acepta inserciones/,
    );
  });

  it('exige un motivo si y solo si el resultado es un fallo', async () => {
    await expect(
      db.appPool.query(`INSERT INTO security_event (event_type, result)
                        VALUES ('login_failed', 'failure')`),
    ).rejects.toThrow(/security_event_failure_reason/);
  });
});

describe('restricciones de sesión', () => {
  it('rechaza un token_hash que no sea un SHA-256 en hexadecimal', async () => {
    await expect(
      db.adminPool.query(
        `INSERT INTO auth_session (user_id, token_hash, idle_expires_at, expires_at)
         VALUES ($1, 'token-en-claro', now(), now())`,
        [userId],
      ),
    ).rejects.toThrow(/auth_session_token_hash_check/);
  });

  it('solo admite hashes Argon2id en las credenciales', async () => {
    await expect(
      db.adminPool.query(`UPDATE app_user_credential SET password_hash = 'texto-plano'`),
    ).rejects.toThrow(/app_user_credential_password_hash_check/);
  });
});
