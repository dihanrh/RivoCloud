import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { findUnauditedMutations } from '@rivocloud/security';

// Vite's import.meta.glob, typed locally so the app does not need vite/client types.
declare global {
  interface ImportMeta {
    glob<T = unknown>(pattern: string, options: { eager: true }): Record<string, T>;
  }
}

const modules = import.meta.glob<Record<string, unknown>>('./**/*.controller.ts', { eager: true });

const controllers = Object.values(modules).flatMap((mod) =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  Object.values(mod).filter((value): value is Function => typeof value === 'function'),
);

describe('audit coverage', () => {
  it('finds the controllers', () => {
    expect(controllers.map((c) => c.name)).toEqual(
      expect.arrayContaining(['BucketsController', 'MinioWebhookController', 'ObjectsController']),
    );
  });

  it('every mutating handler declares @Audit or @NoAudit', () => {
    expect(findUnauditedMutations(controllers)).toEqual([]);
  });
});
