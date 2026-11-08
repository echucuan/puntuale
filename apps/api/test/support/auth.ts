import type { Pool } from 'pg';
import { PasswordHasher } from '../../src/modules/identity/infrastructure/password-hasher';

const hasher = new PasswordHasher();
let counter = 0;

export const TEST_PASSWORD = 'contrasena-ficticia-de-pruebas';

export interface SeededAccount {
  userId: string;
  email: string;
  password: string;
}

/** Crea una cuenta ficticia con la conexión administrativa. Un correo distinto por llamada. */
export async function seedAccount(
  adminPool: Pool,
  options: { status?: 'active' | 'disabled'; email?: string; userId?: string } = {},
): Promise<SeededAccount> {
  counter += 1;
  const email = options.email ?? `cuenta.${counter}@example.test`;
  const passwordHash = await hasher.hash(TEST_PASSWORD);
  let userId = options.userId;
  if (!userId) {
    const { rows } = await adminPool.query<{ id: string }>(
      `INSERT INTO app_user (email, display_name) VALUES ($1, $2) RETURNING id`,
      [email, `Persona ${counter}`],
    );
    userId = rows[0]!.id;
  }
  await adminPool.query(
    `INSERT INTO app_user_credential (user_id, password_hash, status) VALUES ($1, $2, $3)`,
    [userId, passwordHash, options.status ?? 'active'],
  );
  return { userId, email, password: TEST_PASSWORD };
}
