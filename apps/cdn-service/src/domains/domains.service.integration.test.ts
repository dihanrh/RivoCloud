import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { prisma } from '@rivocloud/db';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TraefikConfigPublisher } from './traefik-config.publisher.js';
import { DomainsService } from './domains.service.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const env = { EDGE_PROXY_URL: 'http://edge-proxy-test:8888', EDGE_HOSTNAME: 'edge.rivocloud.dev' };
const publisher = new TraefikConfigPublisher(redis, env as never);
const service = new DomainsService(prisma, redis, env as never, publisher);

async function seedZone() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
  const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
  const zone = await prisma.pullZone.create({
    data: { orgId: org.id, name: 'My Blog', slug: `my-blog-${randomUUID()}`, originUrl: 'https://api.example.com' },
  });
  return { org, zone };
}

describe('DomainsService', () => {
  beforeEach(async () => {
    await prisma.zoneDomain.deleteMany();
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  it('creates a domain scoped to the owning org, lowercased, with a CNAME target', async () => {
    const { org, zone } = await seedZone();
    const domain = await service.create(org.id, zone.id, { domain: `CDN.Example-${randomUUID()}.com` });
    expect(domain.domain).toBe(domain.domain.toLowerCase());
    expect(domain.sslStatus).toBe('pending_dns');
    expect(domain.cnameTarget).toBe('edge.rivocloud.dev');

    const router = `traefik/http/routers/${domain.domain}`;
    expect(await redis.get(`${router}/rule`)).toBe(`Host(\`${domain.domain}\`)`);
  });

  it('rejects creating a domain for a zone owned by a different org', async () => {
    const { zone } = await seedZone();
    await expect(service.create('someone-elses-org', zone.id, { domain: `cdn-${randomUUID()}.example.com` })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a domain that is already registered to any zone', async () => {
    const { org, zone } = await seedZone();
    const domain = `cdn-${randomUUID()}.example.com`;
    await service.create(org.id, zone.id, { domain });
    await expect(service.create(org.id, zone.id, { domain })).rejects.toThrow(ConflictException);
  });

  it('lists domains for a zone', async () => {
    const { org, zone } = await seedZone();
    await service.create(org.id, zone.id, { domain: `a-${randomUUID()}.example.com` });
    await service.create(org.id, zone.id, { domain: `b-${randomUUID()}.example.com` });
    const domains = await service.list(org.id, zone.id);
    expect(domains).toHaveLength(2);
  });

  it('removes a domain, unpublishes Traefik config, and clears any zone_host mapping', async () => {
    const { org, zone } = await seedZone();
    const created = await service.create(org.id, zone.id, { domain: `remove-me-${randomUUID()}.example.com` });
    await redis.set(`zone_host:${created.domain}`, zone.id);

    await service.remove(org.id, zone.id, created.id);

    expect(await prisma.zoneDomain.findUnique({ where: { id: created.id } })).toBeNull();
    expect(await redis.get(`traefik/http/routers/${created.domain}/rule`)).toBeNull();
    expect(await redis.get(`zone_host:${created.domain}`)).toBeNull();
  });

  it('rejects removing a domain that does not belong to the given zone', async () => {
    const { org, zone } = await seedZone();
    const { zone: otherZone } = await seedZone();
    const created = await service.create(org.id, zone.id, { domain: `mismatch-${randomUUID()}.example.com` });
    await expect(service.remove(org.id, otherZone.id, created.id)).rejects.toThrow(NotFoundException);
  });
});
