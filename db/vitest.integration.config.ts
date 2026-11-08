import { defineConfig } from 'vitest/config';

// Pruebas de integración: requieren Docker (Testcontainers levanta PostgreSQL 18).
export default defineConfig({
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
