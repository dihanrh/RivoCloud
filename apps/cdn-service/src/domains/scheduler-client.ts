import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface VerifyDomainResult {
  id: string;
  sslStatus: string;
  sslError: string | null;
}

@Injectable()
export class SchedulerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalSecret: string,
  ) {}

  async verifyDomainNow(domainId: string): Promise<VerifyDomainResult> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/domains/${domainId}/verify-now`, {
        method: 'POST',
        headers: { 'X-Internal-Secret': this.internalSecret },
      });
    } catch {
      throw new ServiceUnavailableException('Scheduler service unreachable');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException('Domain verification failed');
    }
    return (await response.json()) as VerifyDomainResult;
  }
}
