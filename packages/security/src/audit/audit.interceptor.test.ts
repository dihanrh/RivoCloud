import { Logger, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Audit, NoAudit } from './audit.decorator.js';
import { AuditInterceptor } from './audit.interceptor.js';
import type { AuditEntry } from './audit.decorator.js';

class Routes {
  @Audit('zone.created', { resourceType: 'zone', idPath: 'id', bodyFields: ['name'] })
  create() {}

  @Audit('zone.updated', { resourceType: 'zone', orgIdPath: 'orgId' })
  withOrgPath() {}

  @Audit('zone.detached', { resourceType: 'zone', orgIdPath: 'orgId', detachOrg: true })
  detached() {}

  @Audit('zone.deleted', { resourceType: 'zone', idParam: 'zoneId' })
  remove() {}

  @NoAudit()
  skipped() {}

  plain() {}
}

const routes = new Routes();

function ctx(handler: () => void, request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const jwtAuth = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'owner' };

describe('AuditInterceptor', () => {
  let write: ReturnType<typeof vi.fn>;
  let interceptor: AuditInterceptor;
  const run = (handler: () => void, request: Record<string, unknown>, value: unknown = {}) =>
    lastValueFrom(interceptor.intercept(ctx(handler, request), { handle: () => of(value) } as CallHandler));

  beforeEach(() => {
    write = vi.fn().mockResolvedValue(undefined);
    interceptor = new AuditInterceptor(new Reflector(), { write } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('writes nothing for handlers without @Audit', async () => {
    await run(routes.plain, { auth: jwtAuth });
    await run(routes.skipped, { auth: jwtAuth });
    expect(write).not.toHaveBeenCalled();
  });

  it('builds the entry from auth, params, response, and headers', async () => {
    const result = await run(
      routes.create,
      {
        auth: jwtAuth,
        params: {},
        body: { name: 'z', originUrl: 'x' },
        ip: '203.0.113.9',
        headers: { 'user-agent': 'UA', 'x-request-id': 'r1' },
      },
      { id: 'zone-1' },
    );
    expect(result).toEqual({ id: 'zone-1' });
    const expected: AuditEntry = {
      orgId: 'o1',
      userId: 'u1',
      apiKeyId: null,
      action: 'zone.created',
      resourceType: 'zone',
      resourceId: 'zone-1',
      ipAddress: '203.0.113.9',
      userAgent: 'UA',
      requestId: 'r1',
      metadata: { params: {}, body: { name: 'z' } },
    };
    expect(write).toHaveBeenCalledWith(expected);
  });

  it('orgId prefers params.orgId, then orgIdPath, and detachOrg forces null', async () => {
    const base = { auth: jwtAuth, headers: {} };
    await run(routes.withOrgPath, { ...base, params: { orgId: 'p-org' } }, { orgId: 'r-org' });
    expect(write.mock.calls[0][0].orgId).toBe('p-org');

    await run(routes.withOrgPath, { ...base, params: {} }, { orgId: 'r-org' });
    expect(write.mock.calls[1][0].orgId).toBe('r-org');

    await run(routes.withOrgPath, { ...base, params: {} }, {});
    expect(write.mock.calls[2][0].orgId).toBe('o1');

    await run(routes.detached, { ...base, params: { orgId: 'p-org' } }, { orgId: 'r-org' });
    expect(write.mock.calls[3][0].orgId).toBeNull();
  });

  it('idParam reads the route param', async () => {
    await run(routes.remove, { auth: jwtAuth, params: { zoneId: 'z9' }, headers: {} });
    const entry = write.mock.calls[0][0];
    expect(entry.resourceId).toBe('z9');
    expect(entry.metadata).toEqual({ params: { zoneId: 'z9' } });
  });

  it('records apiKeyId for API-key callers', async () => {
    await run(routes.remove, {
      auth: { type: 'api_key', userId: null, orgId: 'o1', role: null, apiKeyId: 'k1' },
      params: { zoneId: 'z9' },
      headers: {},
    });
    const entry = write.mock.calls[0][0];
    expect(entry.apiKeyId).toBe('k1');
    expect(entry.userId).toBeNull();
  });

  it('a writer failure does not fail the request', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    write.mockRejectedValue(new Error('db down'));
    const result = await run(routes.create, { auth: jwtAuth, params: {}, headers: {} }, { id: 'zone-1' });
    expect(result).toEqual({ id: 'zone-1' });
    expect(error).toHaveBeenCalled();
  });

  it('does not write when the handler throws', async () => {
    await expect(
      lastValueFrom(
        interceptor.intercept(ctx(routes.create, { auth: jwtAuth, params: {}, headers: {} }), {
          handle: () => throwError(() => new Error('boom')),
        } as CallHandler),
      ),
    ).rejects.toThrow('boom');
    expect(write).not.toHaveBeenCalled();
  });
});
