import { defineConfig } from 'vitest/config';

// Pruebas de la API por HTTP (supertest) con la base real. Requieren Docker.
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    // La marca de composición es una de las condiciones que exige TestSessionResolver
    // (test/support/test-session.resolver.ts). Solo esta configuración la fija.
    env: { NODE_ENV: 'test', PUNTUALE_TEST_COMPOSITION: 'explicit-test-composition' },
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
