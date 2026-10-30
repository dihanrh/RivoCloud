import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// Config for `pnpm dev` (vite-node). Mirrors vitest.config.ts' SWC transform, plus
// mainFields: ['main'] so class-transformer resolves to its CJS build — the same copy
// Nest's ValidationPipe require()s. Without it vite-node inlines the ESM build and
// @Type() metadata lands in a different registry (query params stay strings -> 400).
export default defineConfig({
  plugins: [swc.vite()],
  resolve: { mainFields: ['main'] },
});
