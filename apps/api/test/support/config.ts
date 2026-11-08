import type { AppConfig, SecurityConfig } from '../../src/config/app-config';

export const TEST_ORIGIN = 'http://localhost:5173';

/** Configuración de pruebas: valores ficticios y límites altos, salvo que una prueba los baje. */
export function testConfig(
  databaseUrl: string,
  overrides: Partial<SecurityConfig> = {},
  nodeEnv: AppConfig['nodeEnv'] = 'test',
): AppConfig {
  return {
    nodeEnv,
    port: 0,
    databaseUrl,
    security: {
      authSecret: 's'.repeat(40),
      corsOrigins: [TEST_ORIGIN],
      session: { absoluteTtlSeconds: 43_200, idleTtlSeconds: 1_800 },
      login: {
        maxFailuresPerAccount: 5,
        maxFailuresPerIp: 20,
        windowSeconds: 900,
        delayBaseMs: 0,
        delayMaxMs: 30_000,
      },
      api: { perIpPerMinute: 100_000, perSessionPerMinute: 100_000 },
      ...overrides,
    },
  };
}
