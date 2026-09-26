import type { PullZone } from '@rivocloud/db';

export type ZoneResponse = Omit<PullZone, 'signingSecret'> & { hasSigningSecret: boolean };

export function toZoneResponse(zone: PullZone): ZoneResponse {
  const { signingSecret, ...rest } = zone;
  return { ...rest, hasSigningSecret: signingSecret !== null };
}
