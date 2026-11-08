import { defineConfig } from 'vitest/config';

// Pruebas de la API por HTTP (supertest) con la base real. Requieren Docker.
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    env: { NODE_ENV: 'test' },
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
