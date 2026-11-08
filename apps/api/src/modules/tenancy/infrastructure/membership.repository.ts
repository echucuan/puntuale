import type { PoolClient } from 'pg';

export interface ActiveMembership {
  membershipId: string;
  tenantId: string;
  userId: string;
}

/**
 * Busca la membresía activa de un usuario en una empresa activa.
 * Se ejecuta dentro de `withTenant`, así que la RLS también restringe la consulta a ese tenant.
 */
export async function findActiveMembership(
  client: PoolClient,
  tenantId: string,
  userId: string,
): Promise<ActiveMembership | null> {
  const { rows } = await client.query<ActiveMembership>(
    `SELECT ut.id AS "membershipId", ut.tenant_id AS "tenantId", ut.user_id AS "userId"
       FROM user_tenant ut
       JOIN tenant t ON t.id = ut.tenant_id
      WHERE ut.tenant_id = $1
        AND ut.user_id = $2
        AND ut.status = 'active'
        AND t.status = 'active'`,
    [tenantId, userId],
  );
  return rows[0] ?? null;
}
