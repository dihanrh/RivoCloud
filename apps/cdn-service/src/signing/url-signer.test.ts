import { describe, expect, it } from 'vitest';
import { buildSignedUrl, signPath } from './url-signer.js';

describe('url-signer', () => {
  // The same vectors are asserted by apps/edge-proxy/internal/signedurl's
  // tests — if either side changes the message format, both suites fail.
  it('matches the shared fixed vector', () => {
    expect(signPath('test-secret', '/private/video.mp4', 1753456789)).toBe(
      '1a2526b473b7f12e9dfb7e7681b9a3964adbb78b6e5d5dff2f3292c5bd8d5ccf',
    );
  });

  it('signs the decoded path, not the percent-encoded one', () => {
    expect(signPath('test-secret', '/reports/q3 2026.pdf', 1753456789)).toBe(
      'bd291068e818939a885b9feb4d5ddf6aaa642f335df18253cc34d6522eaa7293',
    );
  });

  it('changes the signature when the path or expiry changes', () => {
    const base = signPath('s', '/a.txt', 100);
    expect(signPath('s', '/b.txt', 100)).not.toBe(base);
    expect(signPath('s', '/a.txt', 101)).not.toBe(base);
    expect(signPath('t', '/a.txt', 100)).not.toBe(base);
  });

  it('builds a URL with percent-encoded path segments and the signing params', () => {
    expect(
      buildSignedUrl({ scheme: 'https', host: 'cdn.example.com', path: '/reports/q3 2026.pdf', expires: 1753456789, sig: 'abc' }),
    ).toBe('https://cdn.example.com/reports/q3%202026.pdf?expires=1753456789&sig=abc');
  });

  it('encodes reserved characters inside a segment but keeps the slashes between them', () => {
    expect(buildSignedUrl({ scheme: 'http', host: 'h', path: '/a?b/c#d', expires: 1, sig: 's' })).toBe(
      'http://h/a%3Fb/c%23d?expires=1&sig=s',
    );
  });
});
