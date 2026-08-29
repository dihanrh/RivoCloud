import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { prisma } from '@rivocloud/db';
import { EventsService } from '../events/events.service.js';
import { RulesConfigPublisher } from './rules-config.publisher.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const events = new EventsService(process.env.NATS_URL ?? 'nats://localhost:4222');
const publisher = new RulesConfigPublisher(redis, prisma, events);

async function seedZone() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
  const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
  return prisma.pullZone.create({
    data: { orgId: org.id, name: 'My Blog', slug: 'my-blog', originUrl: 'https://api.example.com' },
  });
}

describe('RulesConfigPublisher', () => {
  beforeEach(async () => {
    await prisma.cacheRule.deleteMany();
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(() => {
    redis.disconnect();
  });

  it('writes zone_rules:{id} sorted by priority descending', async () => {
    const zone = await seedZone();
    await prisma.cacheRule.create({ data: { zoneId: zone.id, pattern: '/assets/*', priority: 1 } });
    await prisma.cacheRule.create({ data: { zoneId: zone.id, pattern: '/api/*', action: 'bypass', edgeTtl: 0, priority: 10 } });

    await publisher.publish(zone.id);

    const raw = await redis.get(`zone_rules:${zone.id}`);
    const rules = JSON.parse(raw ?? '[]');
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ pattern: '/api/*', action: 'bypass', priority: 10 });
    expect(rules[1]).toMatchObject({ pattern: '/assets/*', priority: 1 });
  });

  it('publishes a config.zones.updated NATS event carrying the zoneId', async () => {
    const zone = await seedZone();
    await publisher.publish(zone.id);
    expect(events.getLastPublished('config.zones.updated')).toEqual({ zoneId: zone.id });
  });
});
