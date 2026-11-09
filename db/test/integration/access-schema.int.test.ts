import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '../../src/testing';

let db: TestDatabase;

interface Company {
  tenantId: string;
  userId: string;
  membershipId: string;
  email: string;
}

const a = {} as Company;
const b = {} as Company;
const TOKEN_HASH = 'b'.repeat(64);

async function createCompany(target: Company, label: string): Promise<void> {
  const tenant = await db.adminPool.query<{ id: string }>(
    `INSERT INTO tenant (legal_name, timezone) VALUES ($1, 'America/Mexico_City') RETURNING id`,
    [`Empresa ${label}`],
  );
  target.tenantId = tenant.rows[0]!.id;
  target.email = `persona.${label}@example.test`;
  const user = await db.adminPool.query<{ id: string }>(
    `INSERT INTO app_user (email, display_name) VALUES ($1, $2) RETURNING id`,
    [target.email, `Persona ${label}`],
  );
  target.userId = user.rows[0]!.id;
  const membership = await db.adminPool.query<{ id: string }>(
    `INSERT INTO user_tenant (tenant_id, user_id) VALUES ($1, $2) RETURNING id`,
    [target.tenantId, target.userId],
  );
  target.membershipId = membership.rows[0]!.id;
  await db.adminPool.query(
    `INSERT INTO membership_role (tenant_id, membership_id, role_code)
     VALUES ($1, $2, 'company_owner')`,
    [target.tenantId, target.membershipId],
  );
}

async function asTenant<T>(
  tenantId: string | null,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.appPool.connect();
  try {
    await client.query('BEGIN');
    if (tenantId) await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return await work(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

beforeAll(async () => {
  db = await startTestDatabase();
  await createCompany(a, 'a');
  await createCompany(b, 'b');
  await db.adminPool.query(
    `INSERT INTO app_user_credential (user_id, password_hash) VALUES ($1, '$argon2id$v=19$m=65536,t=3,p=1$ZmljdGljaW8$ZmljdGljaW8')`,
    [a.userId],
  );
  await db.adminPool.query(
    `INSERT INTO auth_session (user_id, token_hash, idle_expires_at, expires_at)
     VALUES ($1, $2, now() + interval '30 minutes', now() + interval '12 hours')`,
    [a.userId, TOKEN_HASH],
  );
});

afterAll(async () => {
  await db?.stop();
});

describe('catálogo', () => {
  it('los permisos de módulos futuros están reservados', async () => {
    const { rows } = await db.adminPool.query<{ code: string }>(
      `SELECT code FROM permission WHERE status = 'active' ORDER BY code`,
    );
    expect(rows.map((row) => row.code)).toEqual([
      'access.manage',
      'access.manage_admins',
      'access.read',
    ]);
  });

  it('supervisor y colaborador no tienen ningún permiso activo', async () => {
    const { rows } = await db.adminPool.query(
      `SELECT rp.role_code FROM role_permission rp
         JOIN permission p ON p.code = rp.permission_code AND p.status = 'active'
        WHERE rp.role_code IN ('supervisor', 'employee')`,
    );
    expect(rows).toEqual([]);
  });

  it('solo los roles con acceso administrativo o al directorio exigen MFA', async () => {
    const { rows } = await db.adminPool.query<{ code: string }>(
      `SELECT code FROM role WHERE requires_mfa ORDER BY code`,
    );
    expect(rows.map((row) => row.code)).toEqual(['auditor', 'company_owner', 'hr_admin']);
  });

  it('la aplicación no puede modificar el catálogo', async () => {
    for (const table of ['role', 'permission', 'role_permission']) {
      const { rows } = await db.adminPool.query<{ allowed: boolean }>(
        `SELECT has_table_privilege('puntuale_app', $1, 'INSERT, UPDATE') AS allowed`,
        [`public.${table}`],
      );
      expect(rows, table).toEqual([{ allowed: false }]);
    }
  });
});

describe('membership_role', () => {
  it('sin contexto no se ve ninguna fila; con contexto, solo las de esa empresa', async () => {
    await asTenant(null, async (client) => {
      const { rows } = await client.query('SELECT 1 FROM membership_role');
      expect(rows).toEqual([]);
    });
    await asTenant(a.tenantId, async (client) => {
      const { rows } = await client.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM membership_role',
      );
      expect(rows).toEqual([{ tenant_id: a.tenantId }]);
    });
  });

  it('RLS rechaza asignar en otra empresa', async () => {
    await asTenant(a.tenantId, async (client) => {
      await expect(
        client.query(
          `INSERT INTO membership_role (tenant_id, membership_id, role_code)
           VALUES ($1, $2, 'auditor')`,
          [b.tenantId, b.membershipId],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('la llave compuesta impide ligar una membresía de otra empresa', async () => {
    await expect(
      db.adminPool.query(
        `INSERT INTO membership_role (tenant_id, membership_id, role_code)
         VALUES ($1, $2, 'auditor')`,
        [a.tenantId, b.membershipId],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('un rol vigente no se duplica', async () => {
    await expect(
      db.adminPool.query(
        `INSERT INTO membership_role (tenant_id, membership_id, role_code)
         VALUES ($1, $2, 'company_owner')`,
        [a.tenantId, a.membershipId],
      ),
    ).rejects.toThrow(/membership_role_active_key/);
  });

  it('solo admite el alcance de empresa', async () => {
    await expect(
      db.adminPool.query(
        `INSERT INTO membership_role (tenant_id, membership_id, role_code, scope_type)
         VALUES ($1, $2, 'auditor', 'work_site')`,
        [a.tenantId, a.membershipId],
      ),
    ).rejects.toThrow(/check/);
  });

  it('la aplicación solo actualiza los campos de retiro', async () => {
    const { rows } = await db.adminPool.query<{ column: string; allowed: boolean }>(
      `SELECT c AS column,
              has_column_privilege('puntuale_app', 'public.membership_role', c, 'UPDATE') AS allowed
         FROM unnest(ARRAY['role_code','membership_id','tenant_id','revoked_at','revoked_by_user_id']) c`,
    );
    expect(rows.filter((row) => row.allowed).map((row) => row.column)).toEqual([
      'revoked_at',
      'revoked_by_user_id',
    ]);
  });

  it('de la membresía, la aplicación solo cambia el estado', async () => {
    const { rows } = await db.adminPool.query<{ column: string; allowed: boolean }>(
      `SELECT c AS column,
              has_column_privilege('puntuale_app', 'public.user_tenant', c, 'UPDATE') AS allowed
         FROM unnest(ARRAY['tenant_id','user_id','employee_id','status']) c`,
    );
    expect(rows.filter((row) => row.allowed).map((row) => row.column)).toEqual(['status']);
  });
});

describe('funciones de acceso', () => {
  it('auth_session_tenants solo responde a una sesión vigente', async () => {
    const valid = await db.appPool.query<{ tenant_id: string; requires_mfa: boolean }>(
      'SELECT tenant_id, requires_mfa FROM auth_session_tenants($1)',
      [TOKEN_HASH],
    );
    expect(valid.rows).toEqual([{ tenant_id: a.tenantId, requires_mfa: true }]);
    const unknown = await db.appPool.query('SELECT 1 FROM auth_session_tenants($1)', [
      'c'.repeat(64),
    ]);
    expect(unknown.rows).toEqual([]);
  });

  it('access_member_identities no devuelve nada sin contexto y filtra por empresa', async () => {
    await asTenant(null, async (client) => {
      const { rows } = await client.query('SELECT 1 FROM access_member_identities()');
      expect(rows).toEqual([]);
    });
    await asTenant(a.tenantId, async (client) => {
      const { rows } = await client.query<{ email: string }>(
        'SELECT email FROM access_member_identities()',
      );
      expect(rows).toEqual([{ email: a.email }]);
    });
  });

  it('la aplicación no lee app_user directamente', async () => {
    await expect(db.appPool.query('SELECT email FROM app_user')).rejects.toThrow(/permission/);
  });
});

describe('MFA', () => {
  it('el secreto debe tener el formato cifrado', async () => {
    await expect(
      db.adminPool.query(
        `INSERT INTO user_mfa (user_id, secret_ciphertext, activated_at)
         VALUES ($1, 'JBSWY3DPEHPK3PXP', now())`,
        [b.userId],
      ),
    ).rejects.toThrow(/check/);
  });

  it('el código de recuperación debe ser una huella', async () => {
    await expect(
      db.adminPool.query(
        `INSERT INTO mfa_recovery_code (user_id, code_hash) VALUES ($1, 'ABCD-EFGH-JKLM-NPQR')`,
        [b.userId],
      ),
    ).rejects.toThrow(/check/);
  });

  it('una sesión nueva empieza sin MFA completado', async () => {
    const { rows } = await db.adminPool.query(
      'SELECT mfa_verified_at FROM auth_session WHERE token_hash = $1',
      [TOKEN_HASH],
    );
    expect(rows).toEqual([{ mfa_verified_at: null }]);
  });
});

describe('access_effective_owner_memberships', () => {
  const owners = (tenantId: string | null) =>
    asTenant(tenantId, async (client) => {
      const { rows } = await client.query<{ membership_id: string }>(
        'SELECT membership_id FROM access_effective_owner_memberships()',
      );
      return rows.map((row) => row.membership_id);
    });

  async function withChange(
    change: string,
    undo: string,
    params: unknown[],
    check: () => Promise<void>,
  ) {
    await db.adminPool.query(change, params);
    try {
      await check();
    } finally {
      await db.adminPool.query(undo, params);
    }
  }

  it('devuelve solo el propietario con acceso efectivo de la empresa del contexto', async () => {
    expect(await owners(a.tenantId)).toEqual([a.membershipId]);
    expect(await owners(b.tenantId)).toEqual([]);
  });

  it('sin contexto no devuelve nada', async () => {
    expect(await owners(null)).toEqual([]);
  });

  it('excluye credencial deshabilitada', async () => {
    await withChange(
      `UPDATE app_user_credential SET status = 'disabled' WHERE user_id = $1`,
      `UPDATE app_user_credential SET status = 'active' WHERE user_id = $1`,
      [a.userId],
      async () => expect(await owners(a.tenantId)).toEqual([]),
    );
  });

  it('excluye membresía inactiva', async () => {
    await withChange(
      `UPDATE user_tenant SET status = 'revoked' WHERE id = $1`,
      `UPDATE user_tenant SET status = 'active' WHERE id = $1`,
      [a.membershipId],
      async () => expect(await owners(a.tenantId)).toEqual([]),
    );
  });

  it('excluye rol retirado', async () => {
    await withChange(
      `UPDATE membership_role SET revoked_at = now() WHERE membership_id = $1`,
      `UPDATE membership_role SET revoked_at = NULL WHERE membership_id = $1`,
      [a.membershipId],
      async () => expect(await owners(a.tenantId)).toEqual([]),
    );
  });

  it('la aplicación sigue sin leer las credenciales', async () => {
    await expect(db.appPool.query('SELECT status FROM app_user_credential')).rejects.toThrow(
      /permission/,
    );
  });
});
