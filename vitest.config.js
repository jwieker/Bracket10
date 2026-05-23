import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '/pollService.js': './tests/__mocks__/pollService.js',
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 100000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**', 'server.js', 'jobs/**'],
      exclude: ['src/**/*.test.js', 'tests/**'],
    },
  },
});
