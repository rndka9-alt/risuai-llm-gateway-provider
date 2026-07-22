import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __SETTINGS_STYLES__: JSON.stringify('/* Tailwind CSS is compiled by build.mjs. */'),
    __VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
  },
});
