import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Prisma } from '@rivocloud/db';
import type { PrismaClient, PullZone, ZoneDomain } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { REDIS } from '../redis/redis.module.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';
import { TraefikConfigPublisher } from './traefik-config.publisher.js';
import { toDomainResponse, type DomainResponse } from './domain-response.util.js';
import type { CreateDomainDto } from './dto/create-domain.dto.js';

@Injectable()
export class DomainsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly traefik: TraefikConfigPublisher,
  ) {}

  async create(orgId: string, zoneId: string, dto: CreateDomainDto): Promise<DomainResponse> {
    await this.findOwnedZone(orgId, zoneId);
    const domain = dto.domain.toLowerCase().replace(/\.$/, '');

    let created: ZoneDomain;
    try {
      created = await this.db.zoneDomain.create({ data: { zoneId, domain } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This domain is already in use');
      }
      throw error;
    }
    await this.traefik.publish(domain);
    return toDomainResponse(created, this.env.EDGE_HOSTNAME);
  }

  async list(orgId: string, zoneId: string): Promise<DomainResponse[]> {
    await this.findOwnedZone(orgId, zoneId);
    const domains = await this.db.zoneDomain.findMany({ where: { zoneId }, orderBy: { createdAt: 'asc' } });
    return domains.map((domain) => toDomainResponse(domain, this.env.EDGE_HOSTNAME));
  }

  async remove(orgId: string, zoneId: string, domainId: string): Promise<void> {
    const domain = await this.findOwnedDomain(orgId, zoneId, domainId);
    await this.traefik.unpublish(domain.domain);
    await this.redis.del(`zone_host:${domain.domain}`);
    await this.db.zoneDomain.delete({ where: { id: domainId } });
  }

  async findOwnedDomain(orgId: string, zoneId: string, domainId: string): Promise<ZoneDomain> {
    await this.findOwnedZone(orgId, zoneId);
    const domain = await this.db.zoneDomain.findUnique({ where: { id: domainId } });
    if (!domain || domain.zoneId !== zoneId) {
      throw new NotFoundException('Domain not found');
    }
    return domain;
  }

  private async findOwnedZone(orgId: string, zoneId: string): Promise<PullZone> {
    const zone = await this.db.pullZone.findUnique({ where: { id: zoneId } });
    if (!zone || zone.orgId !== orgId) {
      throw new NotFoundException('Zone not found');
    }
    return zone;
  }
}
