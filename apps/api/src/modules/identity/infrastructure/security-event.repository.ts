import type { ClientBase, Pool } from 'pg';
import type { RequestMeta } from '../domain/active-session';

export type SecurityEventType = 'login_succeeded' | 'login_failed' | 'logout' | 'session_revoked';

export interface SecurityEventInput {
  eventType: SecurityEventType;
  failureReason?: string;
  userId?: string | null;
  sessionId?: string | null;
  identifierHash?: string | null;
  meta: RequestMeta;
}

/** Inserta un evento en la conexión indicada: dentro de la transacción del cambio, si la hay. */
export async function recordSecurityEvent(
  db: ClientBase | Pool,
  input: SecurityEventInput,
): Promise<void> {
  await db.query(
    `INSERT INTO security_event
       (event_type, result, failure_reason, user_id, session_id, identifier_hash,
        request_ip, user_agent, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.eventType,
      input.failureReason === undefined ? 'success' : 'failure',
      input.failureReason ?? null,
      input.userId ?? null,
      input.sessionId ?? null,
      input.identifierHash ?? null,
      input.meta.ip,
      input.meta.userAgent,
      input.meta.requestId,
    ],
  );
}
