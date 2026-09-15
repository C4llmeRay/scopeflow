import { defineConfig } from 'vitest/config';

/**
 * Vitest covers the pure domain logic in src/core only — the measurement
 * engine and the estimate calculator. Those modules import nothing from React
 * Native, so the tests run in plain Node in milliseconds with no Metro, no
 * Babel config and no simulator.
 *
 * Component tests, when they arrive, belong to jest-expo in a separate config.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    reporters: 'verbose',
  },
});
