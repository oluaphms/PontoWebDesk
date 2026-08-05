import { defineConfig } from 'vitest/config';

/**
 * Isolated backend Vitest config.
 * Without this file, Vitest walks up and inherits the repo-root vite.config.ts
 * (environment: jsdom), which externalizes node:fs / node:path / node:url and
 * breaks governance tests that call fileURLToPath / fs / path.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Do not load the frontend vitest.setup.ts (jest-dom / jsdom).
    setupFiles: [],
  },
});
