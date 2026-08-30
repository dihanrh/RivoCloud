import { describe, expect, it, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { TraefikConfigPublisher } from './traefik-config.publisher.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const env = { EDGE_PROXY_URL: 'http://edge-proxy-test:8888' } as { EDGE_PROXY_URL: string };
const publisher = new TraefikConfigPublisher(redis, env as never);

describe('TraefikConfigPublisher', () => {
  afterAll(() => {
    redis.disconnect();
  });

  it('writes the router rule, service reference, entrypoint, and TLS resolver for a domain', async () => {
    const domain = `cdn.publisher-test-${Date.now()}.example.com`;
    await publisher.publish(domain);

    const router = `traefik/http/routers/${domain}`;
    expect(await redis.get(`${router}/rule`)).toBe(`Host(\`${domain}\`)`);
    expect(await redis.get(`${router}/service`)).toBe('edge-proxy');
    expect(await redis.get(`${router}/entryPoints/0`)).toBe('websecure');
    expect(await redis.get(`${router}/tls`)).toBe('true');
    expect(await redis.get(`${router}/tls/certResolver`)).toBe('letsencrypt');

    await publisher.unpublish(domain);
  });

  it('writes the shared edge-proxy service target from EDGE_PROXY_URL', async () => {
    const domain = `cdn.publisher-test-${Date.now()}-b.example.com`;
    await publisher.publish(domain);

    expect(await redis.get('traefik/http/services/edge-proxy/loadBalancer/servers/0/url')).toBe(
      'http://edge-proxy-test:8888',
    );

    await publisher.unpublish(domain);
  });

  it('unpublish removes every router key for that domain', async () => {
    const domain = `cdn.publisher-test-${Date.now()}-c.example.com`;
    await publisher.publish(domain);
    await publisher.unpublish(domain);

    const router = `traefik/http/routers/${domain}`;
    expect(await redis.get(`${router}/rule`)).toBeNull();
    expect(await redis.get(`${router}/service`)).toBeNull();
    expect(await redis.get(`${router}/entryPoints/0`)).toBeNull();
    expect(await redis.get(`${router}/tls`)).toBeNull();
    expect(await redis.get(`${router}/tls/certResolver`)).toBeNull();
  });
});
