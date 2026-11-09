import type { ClientBase, Pool } from 'pg';

export interface UserMfaRow {
  secretCiphertext: string | null;
  pendingCiphertext: string | null;
  /** La inscripción pendiente sigue dentro de su vigencia. */
  pendingActive: boolean;
}

/** Serializa toda operación de MFA de una persona hasta el fin de la transacción. */
export async function lockUserMfa(client: ClientBase, userId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`mfa:${userId}`]);
}

export async function readUserMfa(
  db: ClientBase | Pool,
  userId: string,
  pendingTtlSeconds: number,
): Promise<UserMfaRow | null> {
  const { rows } = await db.query<{
    secret_ciphertext: string | null;
    pending_secret_ciphertext: string | null;
    pending_active: boolean | null;
  }>(
    `SELECT secret_ciphertext, pending_secret_ciphertext,
            pending_created_at > statement_timestamp() - make_interval(secs => $2) AS pending_active
       FROM user_mfa
      WHERE user_id = $1`,
    [userId, pendingTtlSeconds],
  );
  const row = rows[0];
  return row
    ? {
        secretCiphertext: row.secret_ciphertext,
        pendingCiphertext: row.pending_secret_ciphertext,
        pendingActive: row.pending_active === true,
      }
    : null;
}

export async function isMfaEnrolled(db: ClientBase | Pool, userId: string): Promise<boolean> {
  const { rows } = await db.query(
    'SELECT 1 FROM user_mfa WHERE user_id = $1 AND secret_ciphertext IS NOT NULL',
    [userId],
  );
  return rows.length === 1;
}

/** Guarda un secreto pendiente. Si ya hay uno activo, sigue vigente hasta la confirmación. */
export async function savePendingSecret(
  client: ClientBase,
  userId: string,
  ciphertext: string,
): Promise<void> {
  await client.query(
    `INSERT INTO user_mfa (user_id, pending_secret_ciphertext, pending_created_at)
     VALUES ($1, $2, statement_timestamp())
     ON CONFLICT (user_id) DO UPDATE
       SET pending_secret_ciphertext = EXCLUDED.pending_secret_ciphertext,
           pending_created_at = EXCLUDED.pending_created_at,
           updated_at = statement_timestamp()`,
    [userId, ciphertext],
  );
}

/** Convierte el secreto pendiente en el activo y registra el paso con el que se confirmó. */
export async function activatePendingSecret(
  client: ClientBase,
  userId: string,
  step: number,
): Promise<void> {
  await client.query(
    `UPDATE user_mfa
        SET secret_ciphertext = pending_secret_ciphertext,
            activated_at = statement_timestamp(),
            pending_secret_ciphertext = NULL,
            pending_created_at = NULL,
            last_accepted_step = $2,
            updated_at = statement_timestamp()
      WHERE user_id = $1 AND pending_secret_ciphertext IS NOT NULL`,
    [userId, step],
  );
}

export async function clearUserMfa(client: ClientBase, userId: string): Promise<void> {
  await client.query(
    `UPDATE user_mfa
        SET secret_ciphertext = NULL,
            activated_at = NULL,
            pending_secret_ciphertext = NULL,
            pending_created_at = NULL,
            last_accepted_step = NULL,
            updated_at = statement_timestamp()
      WHERE user_id = $1`,
    [userId],
  );
}

/** Acepta el paso solo si es posterior al último aceptado: un código no sirve dos veces. */
export async function acceptTotpStep(
  client: ClientBase,
  userId: string,
  step: number,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE user_mfa
        SET last_accepted_step = $2, updated_at = statement_timestamp()
      WHERE user_id = $1 AND (last_accepted_step IS NULL OR last_accepted_step < $2)`,
    [userId, step],
  );
  return rowCount === 1;
}

export async function insertRecoveryCodes(
  client: ClientBase,
  userId: string,
  hashes: readonly string[],
): Promise<void> {
  await client.query(
    `INSERT INTO mfa_recovery_code (user_id, code_hash) SELECT $1, unnest($2::text[])`,
    [userId, hashes],
  );
}

/** Consume un código de recuperación de forma atómica: solo una petición puede usarlo. */
export async function consumeRecoveryCode(
  client: ClientBase,
  userId: string,
  codeHash: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE mfa_recovery_code
        SET used_at = statement_timestamp()
      WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL AND invalidated_at IS NULL`,
    [userId, codeHash],
  );
  return rowCount === 1;
}

export async function invalidateRecoveryCodes(client: ClientBase, userId: string): Promise<void> {
  await client.query(
    `UPDATE mfa_recovery_code
        SET invalidated_at = statement_timestamp()
      WHERE user_id = $1 AND used_at IS NULL AND invalidated_at IS NULL`,
    [userId],
  );
}

export async function countUsableRecoveryCodes(
  db: ClientBase | Pool,
  userId: string,
): Promise<number> {
  const { rows } = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total
       FROM mfa_recovery_code
      WHERE user_id = $1 AND used_at IS NULL AND invalidated_at IS NULL`,
    [userId],
  );
  return rows[0]!.total;
}

export interface MfaAttemptWindow {
  count: number;
  retryAfterSeconds: number;
}

export async function readMfaAttempts(
  client: ClientBase,
  userId: string,
  windowSeconds: number,
): Promise<MfaAttemptWindow> {
  const { rows } = await client.query<{ total: number; retry_after: number | null }>(
    `SELECT count(*)::int AS total,
            ceil(extract(epoch FROM
              min(occurred_at) + make_interval(secs => $2) - clock_timestamp()))::int AS retry_after
       FROM mfa_attempt
      WHERE user_id = $1 AND occurred_at > clock_timestamp() - make_interval(secs => $2)`,
    [userId, windowSeconds],
  );
  return { count: rows[0]!.total, retryAfterSeconds: Math.max(rows[0]!.retry_after ?? 1, 1) };
}

export async function insertMfaAttempt(client: ClientBase, userId: string): Promise<void> {
  await client.query('INSERT INTO mfa_attempt (user_id) VALUES ($1)', [userId]);
}

export async function clearMfaAttempts(client: ClientBase, userId: string): Promise<void> {
  await client.query('SELECT auth_clear_mfa_attempts($1)', [userId]);
}

export async function purgeMfaAttempts(pool: Pool): Promise<void> {
  await pool.query('SELECT auth_purge_mfa_attempts()');
}

export async function markSessionMfaVerified(client: ClientBase, sessionId: string): Promise<void> {
  await client.query(
    'UPDATE auth_session SET mfa_verified_at = statement_timestamp() WHERE id = $1',
    [sessionId],
  );
}

/** Quita la verificación de las sesiones de la persona, salvo la indicada. */
export async function resetSessionsMfa(
  client: ClientBase,
  userId: string,
  exceptSessionId: string | null,
): Promise<void> {
  await client.query(
    `UPDATE auth_session
        SET mfa_verified_at = NULL
      WHERE user_id = $1 AND mfa_verified_at IS NOT NULL AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [userId, exceptSessionId],
  );
}
