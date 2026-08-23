import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient, PullZone } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { slugify } from './slug.util.js';
import { toZoneResponse } from './zone-response.util.js';
import { ZoneConfigPublisher } from './zone-config.publisher.js';
import type { CreateZoneDto } from './dto/create-zone.dto.js';
import type { UpdateZoneDto } from './dto/update-zone.dto.js';

@Injectable()
export class ZonesService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly publisher: ZoneConfigPublisher,
  ) {}

  async create(orgId: string, dto: CreateZoneDto) {
    const slug = await this.uniqueSlug(orgId, dto.name);
    const zone = await this.db.pullZone.create({
      data: {
        orgId,
        name: dto.name,
        slug,
        originUrl: dto.originUrl,
        originProtocol: dto.originProtocol ?? 'https',
        cacheTtl: dto.cacheTtl ?? 3600,
        browserTtl: dto.browserTtl ?? 0,
      },
    });
    await this.publisher.publish(zone);
    return toZoneResponse(zone);
  }

  async list(orgId: string, skip: number, take: number) {
    const [zones, total] = await Promise.all([
      this.db.pullZone.findMany({ where: { orgId }, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.pullZone.count({ where: { orgId } }),
    ]);
    return { zones: zones.map(toZoneResponse), total };
  }

  async getForOrg(orgId: string, zoneId: string) {
    return toZoneResponse(await this.findOwned(orgId, zoneId));
  }

  async update(orgId: string, zoneId: string, dto: UpdateZoneDto) {
    await this.findOwned(orgId, zoneId);
    const zone = await this.db.pullZone.update({
      where: { id: zoneId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.originUrl !== undefined && { originUrl: dto.originUrl }),
        ...(dto.originProtocol !== undefined && { originProtocol: dto.originProtocol }),
        ...(dto.cacheTtl !== undefined && { cacheTtl: dto.cacheTtl }),
        ...(dto.browserTtl !== undefined && { browserTtl: dto.browserTtl }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
      },
    });
    await this.publisher.publish(zone);
    return toZoneResponse(zone);
  }

  async remove(orgId: string, zoneId: string): Promise<void> {
    const zone = await this.findOwned(orgId, zoneId);
    await this.publisher.unpublish(zone);
    await this.db.pullZone.delete({ where: { id: zoneId } });
  }

  private async findOwned(orgId: string, zoneId: string): Promise<PullZone> {
    const zone = await this.db.pullZone.findUnique({ where: { id: zoneId } });
    if (!zone || zone.orgId !== orgId) {
      throw new NotFoundException('Zone not found');
    }
    return zone;
  }

  private async uniqueSlug(orgId: string, name: string): Promise<string> {
    const base = slugify(name) || 'zone';
    let slug = base;
    let attempt = 0;
    while (await this.db.pullZone.findUnique({ where: { orgId_slug: { orgId, slug } } })) {
      attempt += 1;
      slug = `${base}-${attempt}`;
    }
    return slug;
  }
}
