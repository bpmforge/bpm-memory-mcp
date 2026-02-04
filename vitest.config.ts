import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['mcp/memory-server/src/**/*.ts'],
      exclude: ['mcp/memory-server/src/index.ts'],
    },
    testTimeout: 10000,
    benchmark: {
      include: ['tests/benchmarks/**/*.bench.ts'],
      reporters: ['default'],
      outputFile: {
        json: './benchmark-results.json',
      },
    },
  },
});
