import { describe, expect, it } from 'vitest';
import { parseEdgeRequestEvent } from './parse-event.js';

const VALID_PAYLOAD = {
  timestamp: '2026-06-29T10:00:00Z', zone_id: 'z1', org_id: 'o1', datacenter: 'dc1',
  method: 'GET', path: '/x', status_code: 200, cache_status: 'HIT',
  bytes_sent: 100, duration_ms: 5, country: 'DE', client_ip_hash: 'abc',
};

describe('parseEdgeRequestEvent', () => {
  it('parses a valid edge.request payload', () => {
    const event = parseEdgeRequestEvent(new TextEncoder().encode(JSON.stringify(VALID_PAYLOAD)));
    expect(event).toEqual(VALID_PAYLOAD);
  });

  it('returns null for malformed JSON', () => {
    expect(parseEdgeRequestEvent(new TextEncoder().encode('not json'))).toBeNull();
  });

  it('returns null when a required field is missing', () => {
    expect(parseEdgeRequestEvent(new TextEncoder().encode(JSON.stringify({ zone_id: 'z1' })))).toBeNull();
  });
});
