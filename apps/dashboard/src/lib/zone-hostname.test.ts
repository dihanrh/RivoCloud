import { describe, expect, it } from 'vitest';
import { zoneHostname } from './zone-hostname';

describe('zoneHostname', () => {
  it('joins the slug, the first 8 characters of the id, and the default root domain', () => {
    expect(zoneHostname({ slug: 'my-blog', id: '3f2a9c1e-7b44-4d2e-9a10-5c6d7e8f9a0b' })).toBe(
      'my-blog-3f2a9c1e.cdn.rivocloud.dev',
    );
  });

  it('accepts a custom root domain', () => {
    expect(zoneHostname({ slug: 'assets', id: 'abcdef0123456789' }, 'edge.example.net')).toBe(
      'assets-abcdef01.edge.example.net',
    );
  });
});
