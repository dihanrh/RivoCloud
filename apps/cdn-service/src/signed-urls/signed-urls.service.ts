import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient, PullZone } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';
import { decryptSecret } from '../signing/secret-box.js';
import { buildSignedUrl, signPath } from '../signing/url-signer.js';
import { zoneHostname } from '../zones/zone-hostname.js';
import type { SignUrlInternalDto } from './dto/sign-url-internal.dto.js';

@Injectable()
export class SignedUrlsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async sign(zoneId: string, dto: SignUrlInternalDto): Promise<{ url: string }> {
    const zone = await this.db.pullZone.findUnique({ where: { id: zoneId } });
    if (!zone || zone.orgId !== dto.orgId) {
      throw new NotFoundException('Zone not found');
    }
    // A zone that doesn't verify signatures would serve the object to anyone
    // with or without the sig — handing out a link that only looks
    // protected is worse than refusing.
    if (!zone.signedUrlsRequired || !zone.signingSecret) {
      throw new ConflictException('Signed URLs are not enabled on this zone');
    }
    if (dto.expires <= Math.floor(Date.now() / 1000)) {
      throw new BadRequestException('expires must be in the future');
    }

    const secret = decryptSecret(zone.signingSecret, this.env.ZONE_SECRET_ENCRYPTION_KEY);
    const { scheme, host } = await this.publicOrigin(zone);
    const sig = signPath(secret, dto.path, dto.expires);
    return { url: buildSignedUrl({ scheme, host, path: dto.path, expires: dto.expires, sig }) };
  }

  // Custom domains are always served over TLS by Traefik (Stage 8), so they
  // are https regardless of CDN_URL_SCHEME. isPrimary isn't set by anything
  // yet, so it only breaks ties; otherwise the oldest active domain wins,
  // which keeps the host stable as more domains are added.
  private async publicOrigin(zone: PullZone): Promise<{ scheme: string; host: string }> {
    const domain = await this.db.zoneDomain.findFirst({
      where: { zoneId: zone.id, sslStatus: 'active' },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    if (domain) {
      return { scheme: 'https', host: domain.domain };
    }
    return { scheme: this.env.CDN_URL_SCHEME, host: zoneHostname(zone, this.env.CDN_ROOT_DOMAIN) };
  }
}
