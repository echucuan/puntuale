import type { Pool, PoolClient } from 'pg';

/** Token de inyección del pool de PostgreSQL (rol `puntuale_app`). */
export const PG_POOL = Symbol('PG_POOL');

/**
 * Ejecuta `work` en una transacción con el contexto de tenant fijado (`app.tenant_id`).
 * `set_config(..., true)` es local a la transacción: al terminar, el contexto desaparece y
 * la conexión vuelve limpia al pool. Si `work` falla, todo se revierte, incluida la auditoría (ADR 0005).
 *
 * La autorización ya ocurrió en `TenantGuard`. La RLS es una defensa adicional (ADR 0003).
 */
export async function withTenant<T>(
  pool: Pool,
  tenantId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
