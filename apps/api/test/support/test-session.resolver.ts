import type {
  Session,
  SessionRequest,
  SessionResolver,
} from '../../src/modules/tenancy/domain/session';

/** Encabezado con el que las pruebas declaran el usuario de la sesión. */
export const TEST_SESSION_HEADER = 'x-test-user-id';

/** Valor que solo fijan las configuraciones de Vitest de integración y e2e. */
export const TEST_COMPOSITION_MARKER = 'explicit-test-composition';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export interface TestEnvironmentInput {
  env: Record<string, string | undefined>;
  databaseUrl: string;
}

/**
 * Exige un entorno de pruebas **explícito**. No basta `NODE_ENV=test`; deben cumplirse todas:
 * 1. `NODE_ENV=test`;
 * 2. el proceso lo ejecuta Vitest (`VITEST=true`);
 * 3. la configuración de Vitest marcó la composición de pruebas (`PUNTUALE_TEST_COMPOSITION`);
 * 4. la base de datos es local (Testcontainers en la máquina o en el runner de CI).
 */
export function assertExplicitTestEnvironment({ env, databaseUrl }: TestEnvironmentInput): void {
  const problems: string[] = [];
  if (env['NODE_ENV'] !== 'test') problems.push('NODE_ENV no es test');
  if (env['VITEST'] !== 'true') problems.push('el proceso no lo ejecuta Vitest');
  if (env['PUNTUALE_TEST_COMPOSITION'] !== TEST_COMPOSITION_MARKER) {
    problems.push('falta la marca de composición de pruebas');
  }
  let host = '';
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    problems.push('DATABASE_URL inválida');
  }
  if (host && !LOCAL_HOSTS.has(host)) problems.push(`la base no es local (${host})`);
  if (problems.length > 0) {
    throw new Error(`TestSessionResolver no puede usarse aquí: ${problems.join('; ')}.`);
  }
}

/**
 * Adaptador **solo para pruebas** (ADR 0007). Toma el usuario del encabezado `x-test-user-id`.
 * Solo identifica a la persona: la membresía la sigue validando el `TenantGuard` contra la base.
 *
 * No forma parte de `src/` ni del módulo productivo: solo lo registra `createTestApp()`,
 * y su constructor exige un entorno de pruebas explícito.
 */
export class TestSessionResolver implements SessionResolver {
  constructor(environment: TestEnvironmentInput) {
    assertExplicitTestEnvironment(environment);
  }

  resolve(request: SessionRequest): Promise<Session | null> {
    const raw = request.headers[TEST_SESSION_HEADER];
    const userId = Array.isArray(raw) ? undefined : raw;
    return Promise.resolve(userId && UUID.test(userId) ? { userId: userId.toLowerCase() } : null);
  }
}
