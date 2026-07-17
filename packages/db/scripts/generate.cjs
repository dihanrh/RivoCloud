#!/usr/bin/env node
/**
 * Runs `prisma generate` from this package's own directory.
 *
 * When pnpm executes a workspace package's `postinstall` script, it sets
 * `INIT_CWD` to the directory `pnpm install` was invoked from (the repo
 * root in local dev and in CI). The Prisma CLI has a heuristic that,
 * specifically when it detects it is running as an npm/pnpm
 * lifecycle `postinstall` script *and* `INIT_CWD` is set, computes the
 * default generated-client output path relative to `INIT_CWD` instead of
 * relative to this package's own `node_modules`. Under pnpm's isolated
 * (non-hoisted) node_modules layout, that produces a generated client at
 * the repo-root `node_modules/.prisma/client` that cannot resolve its own
 * `@prisma/client` runtime (which only exists in this package's isolated
 * dependency graph), breaking `new PrismaClient()` at runtime.
 *
 * Deleting `INIT_CWD` before invoking the Prisma CLI avoids that
 * heuristic entirely, so `prisma generate` falls back to computing the
 * output path relative to this package's own resolved `@prisma/client`
 * location, which is what we want.
 */
delete process.env.INIT_CWD;

const { spawnSync } = require("node:child_process");

const result = spawnSync("prisma", ["generate"], {
  stdio: "inherit",
  env: process.env,
  shell: true,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
