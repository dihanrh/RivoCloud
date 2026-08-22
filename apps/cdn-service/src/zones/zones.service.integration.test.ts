import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { Redis } from 'ioredis';
import { prisma } from '@rivocloud/db';
import { EventsService } from '../events/events.service.js';
import { ZonesService } from './zones.service.js';
import { ZoneConfigPublisher } from './zone-config.publisher.js';
import type { AppEnv } from '../env.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const events = new EventsService(process.env.NATS_URL ?? 'nats://localhost:4222');
const publisher = new ZoneConfigPublisher(redis, { CDN_ROOT_DOMAIN: 'cdn.rivocloud.dev' } as AppEnv, events);

async function seedOrg() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Zone Owner' } });
  return prisma.organization.create({ data: { name: 'Zone Org', slug: `zone-org-${randomUUID()}`, ownerId: user.id } });
}

describe('ZonesService', () => {
  const service = new ZonesService(prisma, publisher);

  beforeEach(async () => {
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  it('creates a zone with a generated slug and Stage 4 defaults', async () => {
    const org = await seedOrg();
    const zone = await service.create(org.id, { name: 'My Blog', originUrl: 'https://api.example.com' });

    expect(zone.name).toBe('My Blog');
    expect(zone.slug).toBe('my-blog');
    expect(zone.originUrl).toBe('https://api.example.com');
    expect(zone.originProtocol).toBe('https');
    expect(zone.cacheTtl).toBe(3600);
    expect(zone.browserTtl).toBe(0);
    expect(zone.enabled).toBe(true);
    expect(zone).not.toHaveProperty('signingSecret');
  });

  it('disambiguates a slug collision within the same org', async () => {
    const org = await seedOrg();
    await service.create(org.id, { name: 'My Blog', originUrl: 'https://a.example.com' });
    const second = await service.create(org.id, { name: 'My Blog', originUrl: 'https://b.example.com' });
    expect(second.slug).toBe('my-blog-1');
  });

  it('allows the same slug to be reused in a different org', async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    await service.create(orgA.id, { name: 'My Blog', originUrl: 'https://a.example.com' });
    const zoneB = await service.create(orgB.id, { name: 'My Blog', originUrl: 'https://b.example.com' });
    expect(zoneB.slug).toBe('my-blog');
  });

  it('lists only the calling org zones, paginated, newest first', async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    await service.create(orgA.id, { name: 'A1', originUrl: 'https://a1.example.com' });
    await service.create(orgA.id, { name: 'A2', originUrl: 'https://a2.example.com' });
    await service.create(orgB.id, { name: 'B1', originUrl: 'https://b1.example.com' });

    const page = await service.list(orgA.id, 0, 1);
    expect(page.total).toBe(2);
    expect(page.zones).toHaveLength(1);
    expect(page.zones[0].name).toBe('A2');
  });

  it('rejects getForOrg/update/remove on a zone belonging to a different org', async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    const zone = await service.create(orgA.id, { name: 'A1', originUrl: 'https://a1.example.com' });

    await expect(service.getForOrg(orgB.id, zone.id)).rejects.toThrow(NotFoundException);
    await expect(service.update(orgB.id, zone.id, { name: 'Hijacked' })).rejects.toThrow(NotFoundException);
    await expect(service.remove(orgB.id, zone.id)).rejects.toThrow(NotFoundException);
  });

  it('updates only the fields provided', async () => {
    const org = await seedOrg();
    const zone = await service.create(org.id, { name: 'A1', originUrl: 'https://a1.example.com' });
    const updated = await service.update(org.id, zone.id, { cacheTtl: 60 });
    expect(updated.cacheTtl).toBe(60);
    expect(updated.originUrl).toBe('https://a1.example.com');
  });

  it('removes a zone', async () => {
    const org = await seedOrg();
    const zone = await service.create(org.id, { name: 'A1', originUrl: 'https://a1.example.com' });
    await service.remove(org.id, zone.id);
    await expect(service.getForOrg(org.id, zone.id)).rejects.toThrow(NotFoundException);
  });
});
