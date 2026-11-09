import type { Pool } from 'pg';

export interface LoginAccount {
  userId: string;
  passwordHash: string;
}

/** Localiza una cuenta activa con la función `SECURITY DEFINER`: la API no lee `app_user`. */
export async function findLoginAccount(pool: Pool, email: string): Promise<LoginAccount | null> {
  const { rows } = await pool.query<{ user_id: string; password_hash: string }>(
    'SELECT user_id, password_hash FROM auth_find_account($1)',
    [email],
  );
  const row = rows[0];
  return row ? { userId: row.user_id, passwordHash: row.password_hash } : null;
}
