import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { PullZone } from '@rivocloud/db';
import { REDIS } from '../redis/redis.module.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';
import { EventsService } from '../events/events.service.js';
import { decryptSecret } from '../signing/secret-box.js';
import { zoneHostname } from './zone-hostname.js';

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
      signedUrlsRequired: zone.signedUrlsRequired,
      // The edge verifies signatures locally, so it needs the raw secret —
      // Redis is the one place it leaves this service (EDD Section 5.5). It
      // is only published while the zone actually enforces signed URLs; a
      // zone that requires them with no secret makes the edge fail closed.
      ...(zone.signedUrlsRequired &&
        zone.signingSecret && { signingSecret: decryptSecret(zone.signingSecret, this.env.ZONE_SECRET_ENCRYPTION_KEY) }),
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
    return zoneHostname(zone, this.env.CDN_ROOT_DOMAIN);
  }
}
