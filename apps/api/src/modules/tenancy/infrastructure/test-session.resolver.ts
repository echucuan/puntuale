import type { Session, SessionRequest, SessionResolver } from '../domain/session';

/** Encabezado con el que las pruebas declaran el usuario de la sesión. */
export const TEST_SESSION_HEADER = 'x-test-user-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Adaptador **solo para pruebas** (ADR 0007). Toma el usuario del encabezado `x-test-user-id`.
 * Solo identifica a la persona: la membresía la sigue validando el `TenantGuard` contra la base.
 *
 * El constructor falla si `NODE_ENV` no es `test`, así que la API no puede arrancar con él
 * en desarrollo ni en producción aunque alguien lo registre por error.
 */
export class TestSessionResolver implements SessionResolver {
  constructor(nodeEnv: string | undefined) {
    if (nodeEnv !== 'test') {
      throw new Error('TestSessionResolver solo puede usarse con NODE_ENV=test.');
    }
  }

  resolve(request: SessionRequest): Promise<Session | null> {
    const raw = request.headers[TEST_SESSION_HEADER];
    const userId = Array.isArray(raw) ? undefined : raw;
    return Promise.resolve(userId && UUID.test(userId) ? { userId: userId.toLowerCase() } : null);
  }
}
