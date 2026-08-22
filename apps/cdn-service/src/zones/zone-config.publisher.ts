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
    await this.redis.del(`zone_config:${zone.id}`, `zone_host:${this.hostFor(zone)}`);
    await this.events.publish('config.zones.updated', { zoneId: zone.id });
  }

  private hostFor(zone: PullZone): string {
    return `${zone.slug}.${this.env.CDN_ROOT_DOMAIN}`;
  }
}
