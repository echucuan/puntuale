import type { ClientBase, Pool } from 'pg';
import type { ActiveSessionRecord, RequestMeta } from '../domain/active-session';
import type { PresentedSession } from '../domain/session-rotation';

/** Una actividad más reciente que esto no se vuelve a escribir (ADR 0014). */
const TOUCH_INTERVAL_SECONDS = 60;

export type RevokeReason = 'logout' | 'rotated' | 'user_revoked';

export interface SessionTimes {
  absoluteTtlSeconds: number;
  idleTtlSeconds: number;
}

export interface SessionListItem {
  id: string;
  createdAt: Date;
  lastActivityAt: Date;
  idleExpiresAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

interface IdentityRow {
  session_id: string;
  user_id: string;
  email: string;
  display_name: string;
  created_at: Date;
  last_activity_at: Date;
  idle_expires_at: Date;
  expires_at: Date;
  mfa_verified_at: Date | null;
}

function toRecord(row: IdentityRow): ActiveSessionRecord {
  return {
    id: row.session_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    idleExpiresAt: row.idle_expires_at,
    expiresAt: row.expires_at,
    mfaVerifiedAt: row.mfa_verified_at,
  };
}

/** Sesión activa de un hash de token, o null si no existe, venció, fue revocada o la cuenta no está activa. */
export async function findActiveSession(
  db: ClientBase | Pool,
  tokenHash: string,
): Promise<ActiveSessionRecord | null> {
  const { rows } = await db.query<IdentityRow>('SELECT * FROM auth_session_identity($1)', [
    tokenHash,
  ]);
  return rows[0] ? toRecord(rows[0]) : null;
}

/**
 * Bloquea la sesión de un hash de token, en cualquier estado, hasta el fin de la transacción. Si otra
 * rotación está en curso, espera a que termine y devuelve el estado ya confirmado.
 */
export async function lockPresentedSession(
  client: ClientBase,
  tokenHash: string,
  conflictWindowSeconds: number,
): Promise<PresentedSession | null> {
  const { rows } = await client.query<{
    id: string;
    user_id: string;
    active: boolean;
    recently_rotated: boolean;
  }>(
    `SELECT id, user_id,
            (revoked_at IS NULL
              AND expires_at > statement_timestamp()
              AND idle_expires_at > statement_timestamp()) AS active,
            (revoked_reason IS NOT DISTINCT FROM 'rotated'
              AND revoked_at > statement_timestamp() - make_interval(secs => $2)) AS recently_rotated
       FROM auth_session
      WHERE token_hash = $1
        FOR UPDATE`,
    [tokenHash, conflictWindowSeconds],
  );
  const row = rows[0];
  return row
    ? {
        id: row.id,
        userId: row.user_id,
        active: row.active,
        recentlyRotated: row.recently_rotated === true,
      }
    : null;
}

/** Renueva la inactividad, como máximo una vez por minuto. Nunca extiende la expiración absoluta. */
export async function touchSession(
  pool: Pool,
  session: ActiveSessionRecord,
  idleTtlSeconds: number,
): Promise<ActiveSessionRecord> {
  const { rows } = await pool.query<{ last_activity_at: Date; idle_expires_at: Date }>(
    `UPDATE auth_session
        SET last_activity_at = statement_timestamp(),
            idle_expires_at = statement_timestamp() + make_interval(secs => $2)
      WHERE id = $1
        AND revoked_at IS NULL
        AND last_activity_at < statement_timestamp() - make_interval(secs => $3)
      RETURNING last_activity_at, idle_expires_at`,
    [session.id, idleTtlSeconds, TOUCH_INTERVAL_SECONDS],
  );
  const row = rows[0];
  return row
    ? { ...session, lastActivityAt: row.last_activity_at, idleExpiresAt: row.idle_expires_at }
    : session;
}

export async function insertSession(
  client: ClientBase,
  userId: string,
  tokenHash: string,
  times: SessionTimes,
  meta: RequestMeta,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO auth_session (user_id, token_hash, idle_expires_at, expires_at, request_ip, user_agent)
     VALUES ($1, $2,
             statement_timestamp() + make_interval(secs => $3),
             statement_timestamp() + make_interval(secs => $4),
             $5, $6)
     RETURNING id`,
    [userId, tokenHash, times.idleTtlSeconds, times.absoluteTtlSeconds, meta.ip, meta.userAgent],
  );
  return rows[0]!.id;
}

/** Revoca una sesión. Si se indica `userId`, solo la revoca si pertenece a esa persona. */
export async function revokeSession(
  client: ClientBase,
  sessionId: string,
  reason: RevokeReason,
  userId?: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE auth_session
        SET revoked_at = statement_timestamp(), revoked_reason = $2
      WHERE id = $1 AND revoked_at IS NULL AND ($3::uuid IS NULL OR user_id = $3::uuid)`,
    [sessionId, reason, userId ?? null],
  );
  return rowCount === 1;
}

export async function listActiveSessions(pool: Pool, userId: string): Promise<SessionListItem[]> {
  const { rows } = await pool.query<{
    id: string;
    created_at: Date;
    last_activity_at: Date;
    idle_expires_at: Date;
    expires_at: Date;
    request_ip: string | null;
    user_agent: string | null;
  }>(
    `SELECT id, created_at, last_activity_at, idle_expires_at, expires_at, request_ip, user_agent
       FROM auth_session
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND expires_at > statement_timestamp()
        AND idle_expires_at > statement_timestamp()
      ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    idleExpiresAt: row.idle_expires_at,
    expiresAt: row.expires_at,
    ip: row.request_ip,
    userAgent: row.user_agent,
  }));
}
