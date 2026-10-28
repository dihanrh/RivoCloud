import type { PullZone } from '@rivocloud/db';

// pull_zones.slug is only unique per-org (@@unique([orgId, slug])), but this
// host is a single global DNS namespace shared by every tenant — appending a
// slice of the zone's own UUID makes it globally unique by construction, so
// two orgs naming a zone the same thing can never collide, overwrite, or
// delete each other's edge hostname. Shared by ZoneConfigPublisher (which
// maps the host to the zone in Redis) and the signed-URL signer (which must
// build URLs on exactly the host the edge resolves).
export function zoneHostname(zone: Pick<PullZone, 'slug' | 'id'>, rootDomain: string): string {
  return `${zone.slug}-${zone.id.slice(0, 8)}.${rootDomain}`;
}
