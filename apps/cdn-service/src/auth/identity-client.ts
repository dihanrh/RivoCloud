import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CombinedAuthContext } from './auth-context.decorator.js';

interface IdentityResponseBody {
  userId: string;
  orgId: string;
  role?: string;
  permissions?: string[];
}

@Injectable()
export class IdentityClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalSecret: string,
  ) {}

  async verifyToken(token: string): Promise<CombinedAuthContext> {
    const body = await this.post('/internal/auth/verify-token', { token }, 'Invalid or expired token');
    return { type: 'jwt', userId: body.userId, orgId: body.orgId, role: body.role ?? null };
  }

  async verifyApiKey(apiKey: string): Promise<CombinedAuthContext> {
    const body = await this.post('/internal/auth/verify-api-key', { apiKey }, 'Invalid API key');
    return { type: 'api_key', userId: body.userId, orgId: body.orgId, role: null, permissions: body.permissions };
  }

  private async post(path: string, payload: unknown, failureMessage: string): Promise<IdentityResponseBody> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': this.internalSecret },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new UnauthorizedException('Identity Service unreachable');
    }
    if (!response.ok) {
      throw new UnauthorizedException(failureMessage);
    }
    return (await response.json()) as IdentityResponseBody;
  }
}
