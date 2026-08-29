import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { prisma } from '@rivocloud/db';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { RulesConfigPublisher } from './rules-config.publisher.js';
import { RulesService } from './rules.service.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const events = new EventsService(process.env.NATS_URL ?? 'nats://localhost:4222');
const publisher = new RulesConfigPublisher(redis, prisma, events);
const service = new RulesService(prisma, publisher);

async function seedZone(orgId?: string) {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
  const org = orgId
    ? { id: orgId }
    : await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
  const zone = await prisma.pullZone.create({
    data: { orgId: org.id, name: 'My Blog', slug: `my-blog-${randomUUID()}`, originUrl: 'https://api.example.com' },
  });
  return { org, zone };
}

describe('RulesService', () => {
  beforeEach(async () => {
    await prisma.cacheRule.deleteMany();
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  it('creates a rule scoped to the owning org and publishes it', async () => {
    const { org, zone } = await seedZone();
    const rule = await service.create(org.id, zone.id, { pattern: '/api/*', action: 'bypass', edgeTtl: 0 });
    expect(rule.pattern).toBe('/api/*');
    const raw = await redis.get(`zone_rules:${zone.id}`);
    expect(JSON.parse(raw ?? '[]')).toHaveLength(1);
  });

  it('rejects creating a rule for a zone owned by a different org', async () => {
    const { zone } = await seedZone();
    await expect(service.create('someone-elses-org', zone.id, { pattern: '/x' })).rejects.toThrow(NotFoundException);
  });

  it('requires queryWhitelist when queryString is whitelist', async () => {
    const { org, zone } = await seedZone();
    // Service-level guard mirrors the DTO's ValidateIf, in case a caller
    // bypasses HTTP validation in a test or a future internal caller.
    await expect(
      service.create(org.id, zone.id, { pattern: '/search', queryString: 'whitelist' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('reorders rules by an explicit id list and republishes', async () => {
    const { org, zone } = await seedZone();
    const a = await service.create(org.id, zone.id, { pattern: '/a' });
    const b = await service.create(org.id, zone.id, { pattern: '/b' });

    const reordered = await service.reorder(org.id, zone.id, [b.id, a.id]);
    expect(reordered.rules.find((r) => r.id === b.id)?.priority).toBeGreaterThan(
      reordered.rules.find((r) => r.id === a.id)?.priority ?? Infinity,
    );
  });

  it('rejects reorder with an id list that does not match the zone', async () => {
    const { org, zone } = await seedZone();
    await service.create(org.id, zone.id, { pattern: '/a' });
    await expect(service.reorder(org.id, zone.id, [randomUUID()])).rejects.toThrow(BadRequestException);
  });

  it('deletes a rule and republishes the remaining set', async () => {
    const { org, zone } = await seedZone();
    const rule = await service.create(org.id, zone.id, { pattern: '/a' });
    await service.remove(org.id, zone.id, rule.id);
    const raw = await redis.get(`zone_rules:${zone.id}`);
    expect(JSON.parse(raw ?? '[]')).toHaveLength(0);
  });
});
