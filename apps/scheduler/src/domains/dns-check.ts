import { promises as dns } from 'node:dns';

export interface DnsResolver {
  resolveCname(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '');
}

// Confirms a customer's domain points at RivoCloud before treating it as
// legitimate (concept doc Section 6.1). Tries CNAME first (the record the
// dashboard instructs customers to add); falls back to comparing A records
// so an apex domain — which can't have a CNAME — still verifies correctly
// if the customer used an ALIAS/ANAME record or a manual A record instead.
export async function resolvesToEdge(
  domain: string,
  edgeHostname: string,
  resolver: DnsResolver = dns,
): Promise<boolean> {
  try {
    const cnames = await resolver.resolveCname(domain);
    if (cnames.some((cname) => normalizeHost(cname) === normalizeHost(edgeHostname))) {
      return true;
    }
  } catch {
    // No CNAME record — fall through to comparing A records.
  }
  try {
    const [domainIps, edgeIps] = await Promise.all([resolver.resolve4(domain), resolver.resolve4(edgeHostname)]);
    return domainIps.some((ip) => edgeIps.includes(ip));
  } catch {
    return false;
  }
}
