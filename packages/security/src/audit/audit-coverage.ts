import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants.js';
import { AUDIT_KEY, NO_AUDIT_KEY } from './audit.decorator.js';

const MUTATIONS = new Set<number>([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
]);

/** Returns "Class.method" for each mutating handler with neither @Audit nor @NoAudit. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function findUnauditedMutations(controllers: Function[]): string[] {
  const missing: string[] = [];
  for (const controller of controllers) {
    const proto = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
      if (method === undefined || !MUTATIONS.has(method)) continue;
      // @Audit is handler-only (the interceptor reads it from the handler); @NoAudit may sit on either.
      const declared =
        Reflect.hasMetadata(AUDIT_KEY, handler) ||
        Reflect.hasMetadata(NO_AUDIT_KEY, handler) ||
        Reflect.hasMetadata(NO_AUDIT_KEY, controller);
      if (!declared) missing.push(`${controller.name}.${name}`);
    }
  }
  return missing;
}
