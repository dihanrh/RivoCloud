import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

// Every custom domain's router points at this one shared Traefik "service"
// (its load-balancer backend), rather than each domain getting its own
// service block — the Edge Proxy is a single fleet, not one per domain
// (EDD Section 5.8: "Traefik picks up the change automatically ... No
// Traefik restart required").
const EDGE_SERVICE_NAME = 'edge-proxy';

@Injectable()
export class TraefikConfigPublisher {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async publish(domain: string): Promise<void> {
    // Idempotent: re-written on every domain publish so the shared service
    // target always reflects the current EDGE_PROXY_URL, with no separate
    // startup step required.
    await this.redis.set(
      `traefik/http/services/${EDGE_SERVICE_NAME}/loadBalancer/servers/0/url`,
      this.env.EDGE_PROXY_URL,
    );

    const router = `traefik/http/routers/${domain}`;
    await this.redis.mset({
      [`${router}/rule`]: `Host(\`${domain}\`)`,
      [`${router}/service`]: EDGE_SERVICE_NAME,
      [`${router}/entryPoints/0`]: 'websecure',
      [`${router}/tls`]: 'true',
      [`${router}/tls/certResolver`]: 'letsencrypt',
    });
  }

  async unpublish(domain: string): Promise<void> {
    const router = `traefik/http/routers/${domain}`;
    await this.redis.del(
      `${router}/rule`,
      `${router}/service`,
      `${router}/entryPoints/0`,
      `${router}/tls`,
      `${router}/tls/certResolver`,
    );
  }
}
