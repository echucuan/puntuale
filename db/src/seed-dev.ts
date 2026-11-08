import { hash } from '@node-rs/argon2';
import { Client } from 'pg';

/**
 * `pnpm db:seed`: crea usuarios **ficticios** para probar el login en local. Es idempotente.
 * Se niega a correr en producción o contra una base que no sea local.
 * Las contraseñas son públicas y solo sirven en desarrollo.
 */
const USERS = [
  {
    email: 'ana.demo@puntuale.test',
    displayName: 'Ana Demo',
    password: 'Demo-Ana-2027',
    status: 'active',
  },
  {
    email: 'luis.demo@puntuale.test',
    displayName: 'Luis Demo',
    password: 'Demo-Luis-2027',
    status: 'active',
  },
  {
    email: 'baja.demo@puntuale.test',
    displayName: 'Cuenta Deshabilitada',
    password: 'Demo-Baja-2027',
    status: 'disabled',
  },
] as const;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

async function main(): Promise<void> {
  const adminUrl = process.env['DATABASE_ADMIN_URL'];
  if (!adminUrl) throw new Error('Falta DATABASE_ADMIN_URL. Copia .env.example a .env.');
  if (process.env['NODE_ENV'] === 'production' || !LOCAL_HOSTS.has(new URL(adminUrl).hostname)) {
    throw new Error('La semilla ficticia solo corre contra una base local y fuera de producción.');
  }

  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const user of USERS) {
      const passwordHash = await hash(user.password, {
        memoryCost: 65_536,
        timeCost: 3,
        parallelism: 1,
      });
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO app_user (email, display_name) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
         RETURNING id`,
        [user.email, user.displayName],
      );
      await client.query(
        `INSERT INTO app_user_credential (user_id, password_hash, status) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
           SET password_hash = EXCLUDED.password_hash, status = EXCLUDED.status, updated_at = now()`,
        [rows[0]!.id, passwordHash, user.status],
      );
    }
    await client.query('COMMIT');
    process.stdout.write(`Usuarios ficticios listos: ${USERS.length}.\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
