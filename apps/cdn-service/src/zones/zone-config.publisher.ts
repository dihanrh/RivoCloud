import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { PullZone } from '@rivocloud/db';
import { REDIS } from '../redis/redis.module.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';
import { EventsService } from '../events/events.service.js';

@Injectable()
export class ZoneConfigPublisher {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly events: EventsService,
  ) {}

  async publish(zone: PullZone): Promise<void> {
    const config = {
      id: zone.id,
      orgId: zone.orgId,
      slug: zone.slug,
      originUrl: zone.originUrl,
      originProtocol: zone.originProtocol,
      cacheTtl: zone.cacheTtl,
      browserTtl: zone.browserTtl,
      enabled: zone.enabled,
    };
    await this.redis.set(`zone_config:${zone.id}`, JSON.stringify(config));
    await this.redis.set(`zone_host:${this.hostFor(zone)}`, zone.id);
    await this.events.publish('config.zones.updated', { zoneId: zone.id });
  }

  async unpublish(zone: PullZone): Promise<void> {
    await this.redis.del(`zone_config:${zone.id}`, `zone_host:${this.hostFor(zone)}`, `zone_rules:${zone.id}`);
    await this.events.publish('config.zones.updated', { zoneId: zone.id });
  }

  private hostFor(zone: PullZone): string {
    // pull_zones.slug is only unique per-org (@@unique([orgId, slug])), but
    // this host is a single global DNS namespace shared by every tenant —
    // appending a slice of the zone's own UUID makes it globally unique by
    // construction, so two orgs naming a zone the same thing can never
    // collide, overwrite, or delete each other's edge hostname.
    return `${zone.slug}-${zone.id.slice(0, 8)}.${this.env.CDN_ROOT_DOMAIN}`;
  }
}
