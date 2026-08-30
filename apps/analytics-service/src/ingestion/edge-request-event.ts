import { z } from 'zod';

// Mirrors apps/edge-proxy/internal/analytics/event.go's Event struct exactly
// — this JSON shape is the cross-service contract (EDD Section 2.5).
export const edgeRequestEventSchema = z.object({
  timestamp: z.string(),
  zone_id: z.string(),
  org_id: z.string(),
  datacenter: z.string(),
  method: z.string(),
  path: z.string(),
  status_code: z.number().int(),
  cache_status: z.string(),
  bytes_sent: z.number().int(),
  duration_ms: z.number().int(),
  country: z.string(),
  client_ip_hash: z.string(),
});

export type EdgeRequestEvent = z.infer<typeof edgeRequestEventSchema>;
