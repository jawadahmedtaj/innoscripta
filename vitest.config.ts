import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      ['contracts', 'domain', 'data', 'platform'].map((name) => [
        `@baseline/${name}`,
        fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
      ]),
    ),
  },
  test: { environment: 'node', include: ['**/*.test.{ts,tsx}'], restoreMocks: true },
});
