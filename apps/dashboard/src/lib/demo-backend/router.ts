import { DemoHttpError, isDemoResponse, type DemoResponse } from './http';
import type { DemoCtx, Service } from './context';
import type { World } from './world';
import { identityRoutes } from './routes/identity';
import { cdnRoutes } from './routes/cdn';
import { storageRoutes } from './routes/storage';
import { analyticsRoutes } from './routes/analytics';

export interface Route {
  method: string;
  /** Express-style path with `:param` segments, e.g. `/api/v1/zones/:zoneId`. */
  pattern: string;
  handler: (ctx: DemoCtx) => unknown;
}

interface CompiledRoute extends Route {
  service: Service;
  regex: RegExp;
  keys: string[];
}

function compile(service: Service, routes: Route[]): CompiledRoute[] {
  return routes.map((route) => {
    const keys: string[] = [];
    const source = route.pattern
      .split('/')
      .map((segment) => {
        if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        keys.push(segment.slice(1));
        return '([^/]+)';
      })
      .join('/');
    return { ...route, service, regex: new RegExp(`^${source}$`), keys };
  });
}

const TABLE: Record<Service, CompiledRoute[]> = {
  identity: compile('identity', identityRoutes),
  cdn: compile('cdn', cdnRoutes),
  storage: compile('storage', storageRoutes),
  analytics: compile('analytics', analyticsRoutes),
};

export interface DemoRequest {
  service: Service;
  method: string;
  /** Path plus optional query string, exactly as the dashboard sends it. */
  path: string;
  body?: string;
  accessToken?: string;
  ip?: string | null;
  userAgent?: string | null;
  origin?: string;
  now?: number;
}

/** Dispatches one backend call against `world`; never throws for HTTP-level failures. */
export function dispatch(world: World, req: DemoRequest): DemoResponse {
  const url = new URL(req.path, 'http://demo.invalid');
  const method = (req.method || 'GET').toUpperCase();
  const routes = TABLE[req.service];

  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.regex.exec(url.pathname);
    if (!match) continue;

    let body: Record<string, unknown> = {};
    if (req.body) {
      try {
        const parsed = JSON.parse(req.body);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
      } catch {
        return new DemoHttpError(400, 'Unexpected token in JSON body').toResponse();
      }
    }
    const params: Record<string, string> = {};
    route.keys.forEach((key, i) => {
      params[key] = decodeURIComponent(match[i + 1]);
    });
    const ctx: DemoCtx = {
      world,
      service: req.service,
      method,
      path: url.pathname,
      query: url.searchParams,
      params,
      body,
      accessToken: req.accessToken,
      ip: req.ip ?? null,
      userAgent: req.userAgent ?? null,
      origin: req.origin ?? 'http://localhost:3000',
      now: req.now ?? Date.now(),
    };
    try {
      const result = route.handler(ctx);
      if (isDemoResponse(result)) return { status: result.status, body: result.body };
      return { status: method === 'POST' ? 201 : 200, body: result };
    } catch (err) {
      if (err instanceof DemoHttpError) return err.toResponse();
      throw err;
    }
  }

  // Nest's default 404 for an unknown route.
  return new DemoHttpError(404, `Cannot ${method} ${url.pathname}`).toResponse();
}

/** Which service a base URL points at: the configured URL first, then the path prefix. */
export function serviceFor(baseUrl: string, path: string, urls: Record<Service, string>): Service {
  const normalized = baseUrl.replace(/\/+$/, '');
  for (const [service, url] of Object.entries(urls) as [Service, string][]) {
    if (url.replace(/\/+$/, '') === normalized) return service;
  }
  if (path.startsWith('/api/v1/zones')) return 'cdn';
  if (path.startsWith('/api/v1/buckets')) return 'storage';
  if (path.startsWith('/api/v1/analytics')) return 'analytics';
  return 'identity';
}
