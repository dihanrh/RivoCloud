import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

export interface SignUrlRequest {
  orgId: string;
  path: string;
  expires: number;
}

// Talks to the CDN Service's internal signing endpoint. The zone's signing
// secret stays inside the CDN Service; this service only ever sees the
// finished URL.
@Injectable()
export class CdnClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalSecret: string,
  ) {}

  async signUrl(zoneId: string, body: SignUrlRequest): Promise<{ url: string }> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/zones/${encodeURIComponent(zoneId)}/signed-urls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': this.internalSecret },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ServiceUnavailableException('CDN service unreachable');
    }
    // 404 and 409 describe the caller's request (wrong zone, signing not
    // enabled), so they pass through; anything else is our problem, not theirs.
    if (response.status === 404) {
      throw new NotFoundException('Zone not found');
    }
    if (response.status === 409) {
      throw new ConflictException('Signed URLs are not enabled on this zone');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException('URL signing failed');
    }
    return (await response.json()) as { url: string };
  }
}
