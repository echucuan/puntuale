export type RateLimitScope = 'api_ip' | 'api_session';

export interface RateLimitHit {
  hits: number;
  retryAfterSeconds: number;
}

/**
 * Puerto del contador de peticiones por minuto. Hoy lo implementa PostgreSQL (una sola instancia);
 * con varias instancias se sustituye por Redis sin tocar el guard (ADR 0014).
 */
export interface RateLimitStore {
  hit(scope: RateLimitScope, keyHash: string): Promise<RateLimitHit>;
}

export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');
