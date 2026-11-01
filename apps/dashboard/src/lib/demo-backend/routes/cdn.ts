import { assertValid, badRequest, conflict, notFound, withStatus } from '../http';
import { iso, isBool, isHttpUrl, isInt, isString, optional, recordAudit, requireScope, type DemoCtx } from '../context';
import { newId, sha256, unitHash } from '../ids';
import { EDGE_HOSTNAME, type DomainRec, type ZoneRec } from '../world';
import type { Route } from '../router';
import type { CacheInvalidation, CacheRule } from '../../types';

const ORIGIN_PROTOCOLS = ['http', 'https', 'match'];
const PATTERN_TYPES = ['glob', 'regex', 'exact'];
const RULE_ACTIONS = ['cache', 'bypass', 'no-store'];
const QUERY_STRING_MODES = ['strip_all', 'whitelist', 'include_all'];
const HOSTNAME_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;
/** How long a purge stays "pending" before the demo edges report back. */
const PURGE_SETTLE_MS = 2500;

export function toZoneResponse(zone: ZoneRec) {
  const { signingSecret, ...rest } = zone;
  return { ...rest, hasSigningSecret: signingSecret !== null };
}

const toDomainResponse = (domain: DomainRec) => ({ ...domain, cnameTarget: EDGE_HOSTNAME });

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function findOwnedZone(ctx: DemoCtx, orgId: string, zoneId: string): ZoneRec {
  const zone = ctx.world.zones.find((z) => z.id === zoneId);
  if (!zone || zone.orgId !== orgId) throw notFound('Zone not found');
  return zone;
}

function paging(ctx: DemoCtx, defaultTake = 50) {
  const skipRaw = ctx.query.get('skip');
  const takeRaw = ctx.query.get('take');
  const skip = skipRaw === null ? 0 : Number(skipRaw);
  const take = takeRaw === null ? defaultTake : Number(takeRaw);
  assertValid([
    !(Number.isInteger(skip) && skip >= 0) && 'skip must not be less than 0',
    !(Number.isInteger(take) && take >= 1) && 'take must not be less than 1',
    Number.isInteger(take) && take > 100 && 'take must not be greater than 100',
  ]);
  return { skip, take };
}

function zoneFieldErrors(body: Record<string, unknown>, creating: boolean) {
  const { name, originUrl, originProtocol, cacheTtl, browserTtl, enabled, signedUrlsRequired } = body;
  const nameOk = isString(name) && name.trim().length >= 1 && name.length <= 54;
  return [
    (creating || name !== undefined) && !nameOk && 'name must be shorter than or equal to 54 characters',
    (creating || originUrl !== undefined) && !isHttpUrl(originUrl) && 'originUrl must be a URL address',
    originProtocol !== undefined && !ORIGIN_PROTOCOLS.includes(originProtocol as string) && 'originProtocol must be one of the following values: http, https, match',
    cacheTtl !== undefined && !(isInt(cacheTtl) && cacheTtl >= 0) && 'cacheTtl must not be less than 0',
    browserTtl !== undefined && !(isInt(browserTtl) && browserTtl >= 0) && 'browserTtl must not be less than 0',
    !optional(enabled, isBool) && 'enabled must be a boolean value',
    !optional(signedUrlsRequired, isBool) && 'signedUrlsRequired must be a boolean value',
  ];
}

const newSigningSecret = (seed: string) => sha256(`${seed}:${newId()}`);

function ruleFieldErrors(body: Record<string, unknown>, creating: boolean) {
  const { pattern, patternType, action, edgeTtl, browserTtl, queryString, queryWhitelist, priority } = body;
  const ttlOk = (v: unknown) => v === undefined || v === null || (isInt(v) && v >= 0);
  return [
    (creating || pattern !== undefined) && !(isString(pattern) && pattern.length >= 1 && pattern.length <= 255) && 'pattern must be longer than or equal to 1 characters',
    patternType !== undefined && !PATTERN_TYPES.includes(patternType as string) && 'patternType must be one of the following values: glob, regex, exact',
    action !== undefined && !RULE_ACTIONS.includes(action as string) && 'action must be one of the following values: cache, bypass, no-store',
    !ttlOk(edgeTtl) && 'edgeTtl must not be less than 0',
    !ttlOk(browserTtl) && 'browserTtl must not be less than 0',
    queryString !== undefined && !QUERY_STRING_MODES.includes(queryString as string) && 'queryString must be one of the following values: strip_all, whitelist, include_all',
    queryWhitelist !== undefined && !(Array.isArray(queryWhitelist) && queryWhitelist.every(isString)) && 'each value in queryWhitelist must be a string',
    priority !== undefined && !isInt(priority) && 'priority must be an integer number',
  ];
}

function assertWhitelist(queryString: unknown, whitelist: unknown) {
  if (queryString === 'whitelist' && (!Array.isArray(whitelist) || whitelist.length === 0)) {
    throw badRequest('queryWhitelist is required when queryString is "whitelist"');
  }
}

/** Completes purges that have been pending long enough, like the edges reporting back. */
function settleInvalidations(ctx: DemoCtx) {
  for (const inv of ctx.world.invalidations) {
    if (inv.status === 'pending' && ctx.now - Date.parse(inv.createdAt) >= PURGE_SETTLE_MS) {
      const everything = inv.patterns.includes('*');
      inv.status = 'completed';
      inv.edgesNotified = 3;
      inv.keysPurged = everything ? 400 + Math.floor(unitHash(inv.id) * 2400) : Math.max(1, inv.patterns.length * (1 + Math.floor(unitHash(inv.id) * 4)));
      inv.completedAt = new Date(Date.parse(inv.createdAt) + 1200 + Math.floor(unitHash(`${inv.id}:t`) * 1000)).toISOString();
    }
  }
}

function createInvalidation(ctx: DemoCtx, zoneId: string, userId: string, patterns: string[], tags: string[]) {
  const invalidation: CacheInvalidation = {
    id: newId(),
    zoneId,
    createdBy: userId,
    patterns,
    tags,
    status: 'pending',
    edgesNotified: null,
    keysPurged: null,
    completedAt: null,
    createdAt: iso(ctx),
  };
  ctx.world.invalidations.push(invalidation);
  return { invalidationId: invalidation.id, status: invalidation.status };
}

function listRules(ctx: DemoCtx, zoneId: string, skip: number, take: number) {
  const all = ctx.world.rules.filter((r) => r.zoneId === zoneId).sort((a, b) => b.priority - a.priority);
  return { rules: all.slice(skip, skip + take), total: all.length };
}

export const cdnRoutes: Route[] = [
  // ---------- zones ----------
  {
    method: 'POST',
    pattern: '/api/v1/zones',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'zone:write');
      assertValid(zoneFieldErrors(ctx.body, true));
      const b = ctx.body;
      const name = b.name as string;
      const base = slugify(name) || 'zone';
      let slug = base;
      for (let n = 1; ctx.world.zones.some((z) => z.orgId === caller.orgId && z.slug === slug); n++) slug = `${base}-${n}`;
      const now = iso(ctx);
      const zone: ZoneRec = {
        id: newId(),
        orgId: caller.orgId,
        projectId: null,
        name,
        slug,
        originUrl: b.originUrl as string,
        originProtocol: (b.originProtocol as string | undefined) ?? 'https',
        cacheTtl: (b.cacheTtl as number | undefined) ?? 3600,
        browserTtl: (b.browserTtl as number | undefined) ?? 0,
        enabled: true,
        signedUrlsRequired: b.signedUrlsRequired === true,
        signingSecret: b.signedUrlsRequired === true ? newSigningSecret(slug) : null,
        createdAt: now,
        updatedAt: now,
      };
      ctx.world.zones.push(zone);
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'zone.created', resourceType: 'zone', resourceId: zone.id });
      return withStatus(201, toZoneResponse(zone));
    },
  },
  {
    method: 'GET',
    pattern: '/api/v1/zones',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'zone:read');
      const { skip, take } = paging(ctx);
      const all = ctx.world.zones.filter((z) => z.orgId === caller.orgId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { zones: all.slice(skip, skip + take).map(toZoneResponse), total: all.length };
    },
  },
  {
    method: 'GET',
    pattern: '/api/v1/zones/:zoneId',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'zone:read');
      return toZoneResponse(findOwnedZone(ctx, caller.orgId, ctx.params.zoneId));
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/v1/zones/:zoneId',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'zone:write');
      assertValid(zoneFieldErrors(ctx.body, false));
      const zone = findOwnedZone(ctx, caller.orgId, ctx.params.zoneId);
      const b = ctx.body;
      if (b.signedUrlsRequired === true && zone.signingSecret === null) zone.signingSecret = newSigningSecret(zone.slug);
      for (const field of ['name', 'originUrl', 'originProtocol', 'cacheTtl', 'browserTtl', 'enabled', 'signedUrlsRequired'] as const) {
        if (b[field] !== undefined) (zone as unknown as Record<string, unknown>)[field] = b[field];
      }
      zone.updatedAt = iso(ctx);
      recordAudit(ctx, caller, {
        orgId: caller.orgId,
        action: 'zone.updated',
        resourceType: 'zone',
        resourceId: zone.id,
        bodyFields: ['name', 'originUrl', 'originProtocol', 'cacheTtl', 'browserTtl', 'enabled', 'signedUrlsRequired'],
      });
      return toZoneResponse(zone);
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/zones/:zoneId/signing-secret/rotate',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'zone:write');
      const zone = findOwnedZone(ctx, caller.orgId, ctx.params.zoneId);
      zone.signingSecret = newSigningSecret(zone.slug);
      zone.updatedAt = iso(ctx);
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'zone.signing_secret_rotated', resourceType: 'zone', resourceId: zone.id });
      return withStatus(201, toZoneResponse(zone));
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/v1/zones/:zoneId',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'zone:delete');
      const zone = findOwnedZone(ctx, caller.orgId, ctx.params.zoneId);
      const w = ctx.world;
      w.zones = w.zones.filter((z) => z !== zone);
      w.rules = w.rules.filter((r) => r.zoneId !== zone.id);
      w.domains = w.domains.filter((d) => d.zoneId !== zone.id);
      w.invalidations = w.invalidations.filter((i) => i.zoneId !== zone.id);
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'zone.deleted', resourceType: 'zone', resourceId: zone.id });
      return { success: true };
    },
  },

  // ---------- cache rules ----------
  {
    method: 'POST',
    pattern: '/api/v1/zones/:zoneId/rules',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'zone:write');
      assertValid(ruleFieldErrors(ctx.body, true));
      const zone = findOwnedZone(ctx, caller.orgId, ctx.params.zoneId);
      const b = ctx.body;
      assertWhitelist(b.queryString, b.queryWhitelist);
      const rule: CacheRule = {
        id: newId(),
        zoneId: zone.id,
        pattern: b.pattern as string,
        patternType: (b.patternType as CacheRule['patternType'] | undefined) ?? 'glob',
        action: (b.action as CacheRule['action'] | undefined) ?? 'cache',
        edgeTtl: (b.edgeTtl as number | null | undefined) ?? null,
        browserTtl: (b.browserTtl as number | null | undefined) ?? null,
        queryString: (b.queryString as CacheRule['queryString'] | undefined) ?? 'strip_all',
        queryWhitelist: (b.queryWhitelist as string[] | undefined) ?? [],
        priority: (b.priority as number | undefined) ?? 0,
        createdAt: iso(ctx),
      };
      ctx.world.rules.push(rule);
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'cache_rule.created', resourceType: 'cache_rule', resourceId: rule.id });
      return withStatus(201, rule);
    },
  },
  {
    method: 'GET',
    pattern: '/api/v1/zones/:zoneId/rules',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'zone:read');
      const { skip, take } = paging(ctx);
      const zone = findOwnedZone(ctx, caller.orgId, ctx.params.zoneId);
      return listRules(ctx, zone.id, skip, take);
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/zones/:zoneId/rules/reorder',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'zone:write');
      const order = ctx.body.order;
      assertValid([!(Array.isArray(order) && order.every(isString)) && 'each value in order must be a UUID']);
      const zone = findOwnedZone(ctx, caller.orgId, ctx.params.zoneId);
      const rules = ctx.world.rules.filter((r) => r.zoneId === zone.id);
      const ids = new Set(rules.map((r) => r.id));
      const list = order as string[];
      if (list.length !== rules.length || !list.every((id) => ids.has(id))) {
        throw badRequest("order must contain exactly the zone's existing rule ids");
      }
      list.forEach((id, index) => {
        rules.find((r) => r.id === id)!.priority = list.length - 1 - index;
      });
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'cache_rule.reordered', resourceType: 'zone', resourceId: zone.id });
      return withStatus(201, listRules(ctx, zone.id, 0, 100));
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/v1/zones/:zoneId/rules/:ruleId',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'zone:write');
      assertValid(ruleFieldErrors(ctx.body, false));
      const zone = findOwnedZone(ctx, caller.orgId, ctx.params.zoneId);
      const rule = ctx.world.rules.find((r) => r.id === ctx.params.ruleId && r.zoneId === zone.id);
      if (!rule) throw notFound('Cache rule not found');
      const b = ctx.body;
      assertWhitelist(b.queryString, b.queryWhitelist);
      for (const field of ['pattern', 'patternType', 'action', 'edgeTtl', 'browserTtl', 'queryString', 'queryWhitelist', 'priority'] as const) {
        if (b[field] !== undefined) (rule as unknown as Record<string, unknown>)[field] = b[field];
      }
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'cache_rule.updated', resourceType: 'cache_rule', resourceId: rule.id });
      return rule;
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/v1/zones/:zoneId/rules/:ruleId',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'zone:delete');
      const zone = findOwnedZone(ctx, caller.orgId, ctx.params.zoneId);
      const rule = ctx.world.rules.find((r) => r.id === ctx.params.ruleId && r.zoneId === zone.id);
      if (!rule) throw notFound('Cache rule not found');
      ctx.world.rules = ctx.world.rules.filter((r) => r !== rule);
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'cache_rule.deleted', resourceType: 'cache_rule', resourceId: rule.id });
      return { success: true };
    },
  },

  // ---------- custom domains ----------
  {
    method: 'POST',
    pattern: '/api/v1/zones/:zoneId/domains',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'zone:write');
      const domainName = ctx.body.domain;
      assertValid([
        !(isString(domainName) && domainName.length <= 253 && HOSTNAME_PATTERN.test(domainName)) &&
          'domain must be a valid hostname, e.g. cdn.your-company.com',
      ]);
      const zone = findOwnedZone(ctx, caller.orgId, ctx.params.zoneId);
      const normalized = (domainName as string).toLowerCase();
      if (ctx.world.domains.some((d) => d.domain === normalized)) throw conflict('This domain is already in use');
      const domain: DomainRec = {
        id: newId(),
        zoneId: zone.id,
        domain: normalized,
        sslStatus: 'pending_dns',
        sslError: null,
        certExpiresAt: null,
        isPrimary: false,
        verifiedAt: null,
        createdAt: iso(ctx),
      };
      ctx.world.domains.push(domain);
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'domain.created', resourceType: 'domain', resourceId: domain.id, bodyFields: ['domain'] });
      return withStatus(201, toDomainResponse(domain));
    },
  },
  {
    method: 'GET',
    pattern: '/api/v1/zones/:zoneId/domains',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'zone:read');
      const zone = findOwnedZone(ctx, caller.orgId, ctx.params.zoneId);
      return ctx.world.domains
        .filter((d) => d.zoneId === zone.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(toDomainResponse);
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/v1/zones/:zoneId/domains/:domainId',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'zone:delete');
      const zone = findOwnedZone(ctx, caller.orgId, ctx.params.zoneId);
      const domain = ctx.world.domains.find((d) => d.id === ctx.params.domainId && d.zoneId === zone.id);
      if (!domain) throw notFound('Domain not found');
      ctx.world.domains = ctx.world.domains.filter((d) => d !== domain);
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'domain.deleted', resourceType: 'domain', resourceId: domain.id });
      return { success: true };
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/zones/:zoneId/domains/:domainId/verify',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'zone:write');
      const zone = findOwnedZone(ctx, caller.orgId, ctx.params.zoneId);
      const domain = ctx.world.domains.find((d) => d.id === ctx.params.domainId && d.zoneId === zone.id);
      if (!domain) throw notFound('Domain not found');
      // The demo has no DNS to check: the CNAME is treated as found and a certificate is "issued".
      domain.sslStatus = 'active';
      domain.sslError = null;
      domain.verifiedAt = iso(ctx);
      domain.certExpiresAt = new Date(ctx.now + 90 * 24 * 3600_000).toISOString();
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'domain.verification_requested', resourceType: 'domain', resourceId: domain.id });
      return withStatus(201, { id: domain.id, sslStatus: domain.sslStatus, sslError: domain.sslError });
    },
  },

  // ---------- cache invalidation ----------
  {
    method: 'POST',
    pattern: '/api/v1/zones/:zoneId/cache/invalidate',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'cache:invalidate');
      const { patterns, tags } = ctx.body;
      const listOk = (v: unknown) => v === undefined || (Array.isArray(v) && v.length <= 100 && v.every((s) => isString(s) && s.length <= 255));
      assertValid([!listOk(patterns) && 'each value in patterns must be a string', !listOk(tags) && 'each value in tags must be a string']);
      const zone = findOwnedZone(ctx, caller.orgId, ctx.params.zoneId);
      const p = (patterns as string[] | undefined) ?? [];
      const t = (tags as string[] | undefined) ?? [];
      if (p.length === 0 && t.length === 0) throw badRequest('Provide at least one pattern or tag to invalidate');
      const result = createInvalidation(ctx, zone.id, caller.user.id, p, t);
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'cache.invalidated', resourceType: 'zone', resourceId: zone.id, bodyFields: ['patterns', 'tags'] });
      return withStatus(202, result);
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/zones/:zoneId/cache/purge',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'cache:invalidate');
      const zone = findOwnedZone(ctx, caller.orgId, ctx.params.zoneId);
      const result = createInvalidation(ctx, zone.id, caller.user.id, ['*'], []);
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'cache.purged', resourceType: 'zone', resourceId: zone.id });
      return withStatus(202, result);
    },
  },
  {
    method: 'GET',
    pattern: '/api/v1/zones/:zoneId/cache/invalidations',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'zone:read');
      const { skip, take } = paging(ctx);
      const zone = findOwnedZone(ctx, caller.orgId, ctx.params.zoneId);
      settleInvalidations(ctx);
      const all = ctx.world.invalidations.filter((i) => i.zoneId === zone.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { invalidations: all.slice(skip, skip + take), total: all.length };
    },
  },
  {
    method: 'GET',
    pattern: '/api/v1/zones/:zoneId/cache/invalidations/:invalidationId',
    handler: (ctx) => {
      const caller = requireScope(ctx, 'zone:read');
      const zone = findOwnedZone(ctx, caller.orgId, ctx.params.zoneId);
      settleInvalidations(ctx);
      const inv = ctx.world.invalidations.find((i) => i.id === ctx.params.invalidationId && i.zoneId === zone.id);
      if (!inv) throw notFound('Invalidation not found');
      return inv;
    },
  },
];
