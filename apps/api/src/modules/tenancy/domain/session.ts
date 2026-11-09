import type { SessionMfaState } from './access-policy';

/** Sesión autenticada: solo identifica a la persona. No dice nada sobre a qué empresa pertenece. */
export interface Session {
  userId: string;
}

/** Datos mínimos de la petición que necesita un resolvedor de sesión (sin acoplarse a Express). */
export interface SessionRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Puerto que resuelve la sesión de una petición. Lo implementa el módulo `identity` (ADR 0014).
 * Devuelve `null` si no hay una sesión válida.
 */
export interface SessionResolver {
  resolve(request: SessionRequest): Promise<Session | null>;
}

export const SESSION_RESOLVER = Symbol('SESSION_RESOLVER');

/** Puerto que informa el estado del segundo factor de la sesión de una petición (ADR 0015). */
export interface SessionMfaResolver {
  resolve(request: SessionRequest): Promise<SessionMfaState>;
}

export const SESSION_MFA_RESOLVER = Symbol('SESSION_MFA_RESOLVER');

/** Contexto que el `TenantGuard` adjunta a la petición después de validar la membresía. */
export interface TenantContext {
  tenantId: string;
  userId: string;
  membershipId: string;
}
