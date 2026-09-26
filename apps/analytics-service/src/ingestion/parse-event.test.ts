import { describe, expect, it } from 'vitest';
import { parseEdgeRequestEvent } from './parse-event.js';

const VALID_PAYLOAD = {
  timestamp: '2026-06-29T10:00:00Z', zone_id: 'z1', org_id: 'o1', datacenter: 'dc1',
  method: 'GET', path: '/x', status_code: 200, cache_status: 'HIT',
  bytes_sent: 100, duration_ms: 5, country: 'DE', client_ip_hash: 'abc',
};

function encode(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

describe('parseEdgeRequestEvent', () => {
  it('parses a valid edge.request payload', () => {
    const event = parseEdgeRequestEvent(encode(VALID_PAYLOAD));
    expect(event).toEqual(VALID_PAYLOAD);
  });

  it("accepts Go's RFC3339Nano timestamps and non-Z offsets", () => {
    expect(parseEdgeRequestEvent(encode({ ...VALID_PAYLOAD, timestamp: '2026-06-29T10:00:00.123456789Z' }))).not.toBeNull();
    expect(parseEdgeRequestEvent(encode({ ...VALID_PAYLOAD, timestamp: '2026-06-29T12:00:00+02:00' }))).not.toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseEdgeRequestEvent(new TextEncoder().encode('not json'))).toBeNull();
  });

  it('returns null when a required field is missing', () => {
    expect(parseEdgeRequestEvent(encode({ zone_id: 'z1' }))).toBeNull();
  });

  it('returns null for a too-long country code', () => {
    expect(parseEdgeRequestEvent(encode({ ...VALID_PAYLOAD, country: 'USA' }))).toBeNull();
  });

  it('returns null for a too-short country code', () => {
    expect(parseEdgeRequestEvent(encode({ ...VALID_PAYLOAD, country: 'D' }))).toBeNull();
  });

  it('returns null for a non-letter country code', () => {
    expect(parseEdgeRequestEvent(encode({ ...VALID_PAYLOAD, country: '1A' }))).toBeNull();
    expect(parseEdgeRequestEvent(encode({ ...VALID_PAYLOAD, country: 'ÄÖ' }))).toBeNull();
  });

  it('returns null for a malformed timestamp', () => {
    expect(parseEdgeRequestEvent(encode({ ...VALID_PAYLOAD, timestamp: 'not-a-date' }))).toBeNull();
    expect(parseEdgeRequestEvent(encode({ ...VALID_PAYLOAD, timestamp: '2026-06-29 10:00:00' }))).toBeNull();
    expect(parseEdgeRequestEvent(encode({ ...VALID_PAYLOAD, timestamp: '2026-06-29T10:00:00' }))).toBeNull();
  });
});
