import type { Zone } from './types';

export const DEFAULT_CDN_ROOT_DOMAIN = 'cdn.rivocloud.dev';

// Mirrors apps/cdn-service/src/zones/zone-hostname.ts: the slug alone is only
// unique per account, so a slice of the zone id makes the edge hostname
// globally unique.
export function zoneHostname(zone: Pick<Zone, 'slug' | 'id'>, rootDomain = DEFAULT_CDN_ROOT_DOMAIN): string {
  return `${zone.slug}-${zone.id.slice(0, 8)}.${rootDomain}`;
}
