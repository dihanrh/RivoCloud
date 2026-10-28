import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 20000,
    fileParallelism: false,
    env: { RATE_LIMIT_ENABLED: 'false' },
  },
});
