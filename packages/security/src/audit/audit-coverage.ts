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
      const declared = [handler, controller].some(
        (target) => Reflect.hasMetadata(AUDIT_KEY, target) || Reflect.hasMetadata(NO_AUDIT_KEY, target),
      );
      if (!declared) missing.push(`${controller.name}.${name}`);
    }
  }
  return missing;
}
