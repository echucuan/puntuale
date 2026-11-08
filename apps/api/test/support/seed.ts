import type { Pool } from 'pg';

/**
 * Datos ficticios para pruebas. Se insertan con la conexión administrativa (superusuario),
 * nunca con el rol de aplicación. Ningún dato es real.
 */
export interface SeededTenant {
  tenantId: string;
  userId: string;
  membershipId: string;
  employeeId: string;
}

let counter = 0;

export async function seedTenant(adminPool: Pool, label: string): Promise<SeededTenant> {
  counter += 1;
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query<{ id: string }>(
      `INSERT INTO tenant (legal_name, timezone) VALUES ($1, 'America/Mexico_City') RETURNING id`,
      [`Empresa Ficticia ${label} ${counter}`],
    );
    const tenantId = tenant.rows[0]!.id;
    const user = await client.query<{ id: string }>(
      `INSERT INTO app_user (email, display_name) VALUES ($1, $2) RETURNING id`,
      [`persona.${label.toLowerCase()}.${counter}@example.test`, `Persona ${label}`],
    );
    const userId = user.rows[0]!.id;
    const employee = await client.query<{ id: string }>(
      `INSERT INTO employee (tenant_id, employee_number, display_name)
       VALUES ($1, 'E-001', $2) RETURNING id`,
      [tenantId, `Empleado ${label}`],
    );
    const employeeId = employee.rows[0]!.id;
    const membership = await client.query<{ id: string }>(
      `INSERT INTO user_tenant (tenant_id, user_id, employee_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, userId, employeeId],
    );
    await client.query('COMMIT');
    return { tenantId, userId, employeeId, membershipId: membership.rows[0]!.id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
