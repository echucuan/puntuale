import { defineConfig } from 'vitest/config';

// Pruebas unitarias: sin Docker ni base de datos. Forman parte de `pnpm check`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'],
  },
});
