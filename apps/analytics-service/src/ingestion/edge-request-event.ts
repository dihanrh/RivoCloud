import { z } from 'zod';

// Mirrors apps/edge-proxy/internal/analytics/event.go's Event struct exactly
// — this JSON shape is the cross-service contract (EDD Section 2.5).
//
// `timestamp` and `country` are validated for shape, not just type: they map
// to ClickHouse DateTime64(3, 'UTC') and FixedString(2) columns, and ClickHouse
// rejects an entire JSONEachRow insert when any single row doesn't fit — so an
// out-of-shape value that slipped through here would take every other event in
// the same flush batch down with it. Rejecting it at parse time drops only the
// one bad event (parseEdgeRequestEvent returns null).
export const edgeRequestEventSchema = z.object({
  // Go's time.Time JSON form is RFC3339 with an offset (usually "Z").
  timestamp: z.string().datetime({ offset: true }),
  zone_id: z.string(),
  org_id: z.string(),
  datacenter: z.string(),
  method: z.string(),
  path: z.string(),
  status_code: z.number().int(),
  cache_status: z.string(),
  bytes_sent: z.number().int(),
  duration_ms: z.number().int(),
  country: z.string().length(2).regex(/^[A-Za-z]{2}$/),
  client_ip_hash: z.string(),
});

export type EdgeRequestEvent = z.infer<typeof edgeRequestEventSchema>;
