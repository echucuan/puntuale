import type { Pool, PoolClient } from 'pg';

/**
 * Ejecuta `work` en una transacción sin contexto de tenant. Solo para datos globales de identidad
 * (sesiones y eventos de seguridad, ADR 0014). Si `work` falla, todo se revierte.
 */
export async function withTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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
