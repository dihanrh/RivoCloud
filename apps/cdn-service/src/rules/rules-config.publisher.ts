import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@rivocloud/db';
import { REDIS } from '../redis/redis.module.js';
import { PRISMA } from '../prisma/prisma.module.js';
import { EventsService } from '../events/events.service.js';

@Injectable()
export class RulesConfigPublisher {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly events: EventsService,
  ) {}

  // Re-fires the same config.zones.updated event the Edge Proxy's
  // configsync subscriber already evicts a zone's cached config on
  // (apps/edge-proxy/internal/configsync/subscriber.go) — no new NATS
  // subject needed for rules to reach the Edge Proxy.
  async publish(zoneId: string): Promise<void> {
    const rules = await this.db.cacheRule.findMany({ where: { zoneId }, orderBy: { priority: 'desc' } });
    const payload = rules.map((r) => ({
      pattern: r.pattern,
      patternType: r.patternType,
      action: r.action,
      edgeTtl: r.edgeTtl,
      browserTtl: r.browserTtl,
      queryString: r.queryString,
      queryWhitelist: r.queryWhitelist,
      priority: r.priority,
    }));
    await this.redis.set(`zone_rules:${zoneId}`, JSON.stringify(payload));
    await this.events.publish('config.zones.updated', { zoneId });
  }
}
