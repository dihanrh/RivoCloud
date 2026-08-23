import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { prisma } from '@rivocloud/db';
import { EventsService } from '../events/events.service.js';
import { ZoneConfigPublisher } from './zone-config.publisher.js';
import type { AppEnv } from '../env.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const events = new EventsService(process.env.NATS_URL ?? 'nats://localhost:4222');
const publisher = new ZoneConfigPublisher(redis, { CDN_ROOT_DOMAIN: 'cdn.rivocloud.dev' } as AppEnv, events);

async function seedZone() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
  const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
  return prisma.pullZone.create({
    data: { orgId: org.id, name: 'My Blog', slug: 'my-blog', originUrl: 'https://api.example.com' },
  });
}

describe('ZoneConfigPublisher', () => {
  beforeEach(async () => {
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(() => {
    redis.disconnect();
  });

  it('writes zone_config:{id} and zone_host:{slug}.{rootDomain} to Redis', async () => {
    const zone = await seedZone();
    await publisher.publish(zone);

    const config = JSON.parse((await redis.get(`zone_config:${zone.id}`)) ?? '{}');
    expect(config).toMatchObject({ id: zone.id, originUrl: 'https://api.example.com', cacheTtl: 3600, enabled: true });
    const expectedHost = `my-blog-${zone.id.slice(0, 8)}.cdn.rivocloud.dev`;
    expect(await redis.get(`zone_host:${expectedHost}`)).toBe(zone.id);
  });

  it('publishes a config.zones.updated NATS event carrying the zoneId', async () => {
    const zone = await seedZone();
    await publisher.publish(zone);
    expect(events.getLastPublished('config.zones.updated')).toEqual({ zoneId: zone.id });
  });

  it('deletes both Redis keys on unpublish', async () => {
    const zone = await seedZone();
    await publisher.publish(zone);
    await publisher.unpublish(zone);

    expect(await redis.get(`zone_config:${zone.id}`)).toBeNull();
    const expectedHost = `my-blog-${zone.id.slice(0, 8)}.cdn.rivocloud.dev`;
    expect(await redis.get(`zone_host:${expectedHost}`)).toBeNull();
  });
});
