import type { PullZone } from '@rivocloud/db';

export type ZoneResponse = Omit<PullZone, 'signingSecret'>;

export function toZoneResponse(zone: PullZone): ZoneResponse {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit it from `rest`
  const { signingSecret: _signingSecret, ...rest } = zone;
  return rest;
}
