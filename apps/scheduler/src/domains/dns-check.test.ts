import { describe, expect, it } from 'vitest';
import { resolvesToEdge, type DnsResolver } from './dns-check.js';

function fakeResolver(overrides: Partial<DnsResolver>): DnsResolver {
  return {
    resolveCname: async () => {
      throw new Error('no CNAME');
    },
    resolve4: async () => {
      throw new Error('no A record');
    },
    ...overrides,
  };
}

describe('resolvesToEdge', () => {
  it('returns true when the domain has a CNAME pointing at the edge hostname', async () => {
    const resolver = fakeResolver({ resolveCname: async () => ['edge.rivocloud.dev.'] });
    expect(await resolvesToEdge('cdn.example.com', 'edge.rivocloud.dev', resolver)).toBe(true);
  });

  it('is case-insensitive and ignores a trailing dot', async () => {
    const resolver = fakeResolver({ resolveCname: async () => ['EDGE.RivoCloud.dev'] });
    expect(await resolvesToEdge('cdn.example.com', 'edge.rivocloud.dev', resolver)).toBe(true);
  });

  it('returns false when the CNAME points elsewhere and no A record matches', async () => {
    const resolver = fakeResolver({
      resolveCname: async () => ['someone-else.example.net'],
      resolve4: async (host: string) => (host === 'edge.rivocloud.dev' ? ['1.2.3.4'] : ['9.9.9.9']),
    });
    expect(await resolvesToEdge('cdn.example.com', 'edge.rivocloud.dev', resolver)).toBe(false);
  });

  it('falls back to comparing A records when there is no CNAME (apex domain)', async () => {
    const resolver = fakeResolver({
      resolve4: async (host: string) => (host === 'cdn.example.com' ? ['1.2.3.4'] : ['1.2.3.4']),
    });
    expect(await resolvesToEdge('cdn.example.com', 'edge.rivocloud.dev', resolver)).toBe(true);
  });

  it('returns false when neither CNAME nor A record resolution succeeds', async () => {
    const resolver = fakeResolver({});
    expect(await resolvesToEdge('cdn.example.com', 'edge.rivocloud.dev', resolver)).toBe(false);
  });
});
