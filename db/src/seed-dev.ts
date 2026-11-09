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
    email: 'admin.demo@puntuale.test',
    displayName: 'Administración Demo',
    password: 'Demo-Admin-2027',
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

/** Empresa ficticia del piloto. Sus identificadores los genera la base en cada instalación. */
const PILOT_TENANT = { legalName: 'Empresa Piloto Demo', timezone: 'America/Mexico_City' };

/** Membresías del piloto. Solo Ana y Luis son colaboradores: la cuenta administradora no. */
const PILOT_MEMBERS = [
  {
    email: 'ana.demo@puntuale.test',
    employee: { number: 'DEMO-001', displayName: 'Ana Demo' },
    role: 'employee',
  },
  {
    email: 'luis.demo@puntuale.test',
    employee: { number: 'DEMO-002', displayName: 'Luis Demo' },
    role: 'employee',
  },
  { email: 'admin.demo@puntuale.test', employee: null, role: 'company_owner' },
] as const;

/**
 * Crea la empresa y lo que le falte. No modifica membresías ni roles existentes, para que repetir la
 * semilla no deshaga lo que se probó en la pantalla de accesos. Nunca toca el MFA.
 */
async function seedPilot(client: Client): Promise<void> {
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM tenant WHERE legal_name = $1',
    [PILOT_TENANT.legalName],
  );
  const tenantId =
    existing.rows[0]?.id ??
    (
      await client.query<{ id: string }>(
        'INSERT INTO tenant (legal_name, timezone) VALUES ($1, $2) RETURNING id',
        [PILOT_TENANT.legalName, PILOT_TENANT.timezone],
      )
    ).rows[0]!.id;

  for (const member of PILOT_MEMBERS) {
    const user = await client.query<{ id: string }>('SELECT id FROM app_user WHERE email = $1', [
      member.email,
    ]);
    const userId = user.rows[0]!.id;
    const membership = await client.query(
      'SELECT 1 FROM user_tenant WHERE tenant_id = $1 AND user_id = $2',
      [tenantId, userId],
    );
    if (membership.rows.length > 0) continue;

    const employeeId = member.employee
      ? (
          await client.query<{ id: string }>(
            `INSERT INTO employee (tenant_id, employee_number, display_name)
             VALUES ($1, $2, $3) RETURNING id`,
            [tenantId, member.employee.number, member.employee.displayName],
          )
        ).rows[0]!.id
      : null;
    const created = await client.query<{ id: string }>(
      `INSERT INTO user_tenant (tenant_id, user_id, employee_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, userId, employeeId],
    );
    await client.query(
      'INSERT INTO membership_role (tenant_id, membership_id, role_code) VALUES ($1, $2, $3)',
      [tenantId, created.rows[0]!.id, member.role],
    );
  }
}

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
    await seedPilot(client);
    await client.query('COMMIT');
    process.stdout.write(
      `Usuarios ficticios listos: ${USERS.length}. Empresa piloto: ${PILOT_TENANT.legalName}.\n`,
    );
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
