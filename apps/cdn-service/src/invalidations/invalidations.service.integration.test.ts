import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { connect, type NatsConnection } from 'nats';
import { prisma } from '@rivocloud/db';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { InvalidationsService } from './invalidations.service.js';

const natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222';
const events = new EventsService(natsUrl);
const service = new InvalidationsService(prisma, events);

async function seedZone() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
  const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
  return { org, zone: await prisma.pullZone.create({
    data: { orgId: org.id, name: 'My Blog', slug: `my-blog-${randomUUID()}`, originUrl: 'https://api.example.com' },
  })};
}

describe('InvalidationsService', () => {
  let responder: NatsConnection | null = null;

  beforeEach(async () => {
    await prisma.cacheInvalidation.deleteMany();
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await responder?.close();
    responder = null;
  });

  it('rejects an invalidation request with no patterns or tags', async () => {
    const { org, zone } = await seedZone();
    await expect(service.create(org.id, zone.id, null, {})).rejects.toThrow(BadRequestException);
  });

  it('rejects invalidating a zone owned by a different org', async () => {
    const { zone } = await seedZone();
    await expect(service.create('someone-elses-org', zone.id, null, { patterns: ['/x'] })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns pending immediately, then completes once an edge proxy replies', async () => {
    const { org, zone } = await seedZone();
    responder = await connect({ servers: natsUrl });
    const sub = responder.subscribe(`cache.invalidate.${zone.id}`);
    (async () => {
      for await (const msg of sub) {
        if (msg.reply) {
          responder!.publish(msg.reply, new TextEncoder().encode(JSON.stringify({ datacenter: 'local', keysPurged: 7, durationMs: 3 })));
        }
      }
    })();

    const result = await service.create(org.id, zone.id, null, { patterns: ['/logo.png'] });
    expect(result.status).toBe('pending');

    // collectAndFinalize runs in the background (not awaited by create()) —
    // poll for the row to flip to completed. requestMany always waits out
    // its full REPLY_WINDOW_MS (5000ms) before returning collected replies
    // (it can't know how many edge proxies to expect), so the poll budget
    // here must comfortably exceed that window.
    let final = await prisma.cacheInvalidation.findUnique({ where: { id: result.invalidationId } });
    for (let i = 0; i < 70 && final?.status !== 'completed'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      final = await prisma.cacheInvalidation.findUnique({ where: { id: result.invalidationId } });
    }
    expect(final?.status).toBe('completed');
    expect(final?.edgesNotified).toBe(1);
    expect(final?.keysPurged).toBe(7);
  });

  it('purgeAll invalidates with a wildcard pattern', async () => {
    const { org, zone } = await seedZone();
    const result = await service.purgeAll(org.id, zone.id, null);
    const row = await prisma.cacheInvalidation.findUnique({ where: { id: result.invalidationId } });
    expect(row?.patterns).toEqual(['*']);
  });

  it('marks the invalidation failed (not stuck pending) when finalizing throws', async () => {
    const { org, zone } = await seedZone();
    const throwingEvents = {
      requestMany: async () => {
        throw new Error('simulated NATS failure');
      },
    } as unknown as EventsService;
    const throwingService = new InvalidationsService(prisma, throwingEvents);

    const result = await throwingService.create(org.id, zone.id, null, { patterns: ['/logo.png'] });
    expect(result.status).toBe('pending');

    let final = await prisma.cacheInvalidation.findUnique({ where: { id: result.invalidationId } });
    for (let i = 0; i < 50 && final?.status === 'pending'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      final = await prisma.cacheInvalidation.findUnique({ where: { id: result.invalidationId } });
    }
    expect(final?.status).toBe('failed');
  });
});
