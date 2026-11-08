import type { Session, SessionResolver } from '../domain/session';

/**
 * Resolvedor de desarrollo y producción en 1.0-a: **nunca** hay sesión, así que toda ruta
 * protegida responde 401. No existe ningún atajo de desarrollo (ADR 0007).
 */
export class NoSessionResolver implements SessionResolver {
  resolve(): Promise<Session | null> {
    return Promise.resolve(null);
  }
}
