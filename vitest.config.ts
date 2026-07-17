import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __SETTINGS_STYLES__: JSON.stringify('/* Tailwind CSS is compiled by build.mjs. */'),
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
  },
});
