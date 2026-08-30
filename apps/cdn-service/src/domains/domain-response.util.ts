import type { ZoneDomain } from '@rivocloud/db';

export interface DomainResponse extends ZoneDomain {
  cnameTarget: string;
}

export function toDomainResponse(domain: ZoneDomain, cnameTarget: string): DomainResponse {
  return { ...domain, cnameTarget };
}
