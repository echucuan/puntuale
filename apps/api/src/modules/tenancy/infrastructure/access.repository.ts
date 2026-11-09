import {
  ACTIVE_PERMISSIONS,
  type AccessMember,
  type ActivePermission,
  type MyTenant,
  type RoleCode,
} from '@puntuale/contracts';
import type { Pool, PoolClient } from 'pg';
import type { AccessTarget, RoleGrant } from '../domain/access-policy';

const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(ACTIVE_PERMISSIONS);

/**
 * Roles vigentes de una membresía con sus permisos. Solo se leen los permisos `active`: un permiso
 * reservado nunca llega a la aplicación.
 */
export async function loadRoleGrants(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
): Promise<RoleGrant[]> {
  const { rows } = await client.query<{
    role: RoleCode;
    requires_mfa: boolean;
    is_admin: boolean;
    permissions: string[];
  }>(
    `SELECT r.code AS role, r.requires_mfa, r.is_admin,
            COALESCE(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
       FROM membership_role mr
       JOIN role r ON r.code = mr.role_code
       LEFT JOIN role_permission rp ON rp.role_code = r.code
       LEFT JOIN permission p ON p.code = rp.permission_code AND p.status = 'active'
      WHERE mr.tenant_id = $1 AND mr.membership_id = $2
        AND mr.revoked_at IS NULL AND mr.scope_type = 'tenant'
      GROUP BY r.code, r.requires_mfa, r.is_admin
      ORDER BY r.code`,
    [tenantId, membershipId],
  );
  return rows.map((row) => ({
    role: row.role,
    requiresMfa: row.requires_mfa,
    isAdmin: row.is_admin,
    permissions: row.permissions.filter((code): code is ActivePermission =>
      KNOWN_PERMISSIONS.has(code),
    ),
  }));
}

/** Empresas de la sesión con ese hash de token. La función valida la sesión en la base. */
export async function listTenantsForSession(pool: Pool, tokenHash: string): Promise<MyTenant[]> {
  const { rows } = await pool.query<{
    tenant_id: string;
    legal_name: string;
    membership_id: string;
    roles: RoleCode[];
    requires_mfa: boolean;
  }>('SELECT * FROM auth_session_tenants($1)', [tokenHash]);
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    legalName: row.legal_name,
    membershipId: row.membership_id,
    roles: row.roles,
    requiresMfa: row.requires_mfa,
  }));
}

export interface TenantSummary {
  id: string;
  legalName: string;
  timezone: string;
}

export async function findTenantSummary(
  client: PoolClient,
  tenantId: string,
): Promise<TenantSummary> {
  const { rows } = await client.query<TenantSummary>(
    `SELECT id, legal_name AS "legalName", timezone FROM tenant WHERE id = $1`,
    [tenantId],
  );
  return rows[0]!;
}

export interface MemberIdentity {
  email: string;
  displayName: string;
}

export async function findMemberIdentity(
  client: PoolClient,
  userId: string,
): Promise<MemberIdentity> {
  const { rows } = await client.query<MemberIdentity>(
    `SELECT email, display_name AS "displayName"
       FROM access_member_identities() WHERE user_id = $1`,
    [userId],
  );
  return rows[0]!;
}

export interface LinkedEmployee {
  employeeNumber: string;
  displayName: string;
}

export async function findLinkedEmployee(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
): Promise<LinkedEmployee | null> {
  const { rows } = await client.query<LinkedEmployee>(
    `SELECT e.employee_number AS "employeeNumber", e.display_name AS "displayName"
       FROM user_tenant ut
       JOIN employee e ON e.tenant_id = ut.tenant_id AND e.id = ut.employee_id
      WHERE ut.tenant_id = $1 AND ut.id = $2`,
    [tenantId, membershipId],
  );
  return rows[0] ?? null;
}

/** Membresías de la empresa del contexto. `access_member_identities` filtra por ese mismo tenant. */
export async function listAccessMembers(
  client: PoolClient,
  tenantId: string,
  actorMembershipId: string,
): Promise<AccessMember[]> {
  const { rows } = await client.query<Omit<AccessMember, 'isSelf'>>(
    `SELECT ut.id AS "membershipId", i.display_name AS "displayName", i.email, ut.status,
            e.employee_number AS "employeeNumber",
            COALESCE(array_agg(mr.role_code ORDER BY mr.role_code)
                     FILTER (WHERE mr.role_code IS NOT NULL), '{}') AS roles
       FROM user_tenant ut
       JOIN access_member_identities() i ON i.user_id = ut.user_id
       LEFT JOIN employee e ON e.tenant_id = ut.tenant_id AND e.id = ut.employee_id
       LEFT JOIN membership_role mr
         ON mr.tenant_id = ut.tenant_id AND mr.membership_id = ut.id AND mr.revoked_at IS NULL
      WHERE ut.tenant_id = $1
      GROUP BY ut.id, i.display_name, i.email, ut.status, e.employee_number
      ORDER BY i.display_name, ut.id`,
    [tenantId],
  );
  return rows.map((row) => ({ ...row, isSelf: row.membershipId === actorMembershipId }));
}

export async function listAdminRoles(client: PoolClient): Promise<RoleCode[]> {
  const { rows } = await client.query<{ code: RoleCode }>(
    'SELECT code FROM role WHERE is_admin ORDER BY code',
  );
  return rows.map((row) => row.code);
}

export async function isAdminRole(client: PoolClient, role: RoleCode): Promise<boolean> {
  const { rows } = await client.query<{ is_admin: boolean }>(
    'SELECT is_admin FROM role WHERE code = $1',
    [role],
  );
  return rows[0]?.is_admin === true;
}

/** Serializa los cambios de acceso de una empresa hasta el fin de la transacción. */
export async function lockTenantAccess(client: PoolClient, tenantId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `access:${tenantId}`,
  ]);
}

export interface LockedTarget extends AccessTarget {
  userId: string;
  employeeId: string | null;
}

export async function findAccessTarget(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
): Promise<LockedTarget | null> {
  const { rows } = await client.query<{
    user_id: string;
    employee_id: string | null;
    status: 'active' | 'revoked';
    roles: { code: RoleCode; isAdmin: boolean }[];
  }>(
    `SELECT ut.user_id, ut.employee_id, ut.status,
            COALESCE(json_agg(json_build_object('code', r.code, 'isAdmin', r.is_admin))
                     FILTER (WHERE r.code IS NOT NULL), '[]') AS roles
       FROM user_tenant ut
       LEFT JOIN membership_role mr
         ON mr.tenant_id = ut.tenant_id AND mr.membership_id = ut.id AND mr.revoked_at IS NULL
       LEFT JOIN role r ON r.code = mr.role_code
      WHERE ut.tenant_id = $1 AND ut.id = $2
      GROUP BY ut.user_id, ut.employee_id, ut.status`,
    [tenantId, membershipId],
  );
  const row = rows[0];
  return row
    ? {
        membershipId,
        userId: row.user_id,
        employeeId: row.employee_id,
        status: row.status,
        roles: row.roles,
      }
    : null;
}

/**
 * Membresías de la empresa del contexto con membresía activa, rol de propietario vigente y credencial
 * activa. La credencial solo se consulta dentro de la función: `puntuale_app` no la lee.
 */
export async function listEffectiveOwners(client: PoolClient): Promise<ReadonlySet<string>> {
  const { rows } = await client.query<{ membership_id: string }>(
    'SELECT membership_id FROM access_effective_owner_memberships()',
  );
  return new Set(rows.map((row) => row.membership_id));
}

/** Devuelve el id de la asignación creada, o null si el rol ya estaba vigente. */
export async function assignRole(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
  role: RoleCode,
  actorUserId: string,
): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO membership_role (tenant_id, membership_id, role_code, assigned_by_user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, membership_id, role_code) WHERE revoked_at IS NULL DO NOTHING
     RETURNING id`,
    [tenantId, membershipId, role, actorUserId],
  );
  return rows[0]?.id ?? null;
}

/** Devuelve el id de la asignación retirada, o null si el rol no estaba vigente. */
export async function retireRole(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
  role: RoleCode,
  actorUserId: string,
): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `UPDATE membership_role
        SET revoked_at = statement_timestamp(), revoked_by_user_id = $4
      WHERE tenant_id = $1 AND membership_id = $2 AND role_code = $3 AND revoked_at IS NULL
      RETURNING id`,
    [tenantId, membershipId, role, actorUserId],
  );
  return rows[0]?.id ?? null;
}

/** Devuelve true solo si el estado cambió. */
export async function setMembershipStatus(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
  status: 'active' | 'revoked',
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE user_tenant SET status = $3 WHERE tenant_id = $1 AND id = $2 AND status <> $3`,
    [tenantId, membershipId, status],
  );
  return rowCount === 1;
}
