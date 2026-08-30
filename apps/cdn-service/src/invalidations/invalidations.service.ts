import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CacheInvalidation, PrismaClient } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { EventsService } from '../events/events.service.js';
import type { CreateInvalidationDto } from './dto/create-invalidation.dto.js';

interface EdgeInvalidationReply {
  datacenter: string;
  keysPurged: number;
  durationMs: number;
}

const REPLY_WINDOW_MS = 5000;

@Injectable()
export class InvalidationsService {
  private readonly logger = new Logger(InvalidationsService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly events: EventsService,
  ) {}

  async create(
    orgId: string,
    zoneId: string,
    userId: string | null,
    dto: CreateInvalidationDto,
  ): Promise<{ invalidationId: string; status: string }> {
    await this.findOwnedZone(orgId, zoneId);
    const patterns = dto.patterns ?? [];
    const tags = dto.tags ?? [];
    if (patterns.length === 0 && tags.length === 0) {
      throw new BadRequestException('Provide at least one pattern or tag to invalidate');
    }

    const invalidation = await this.db.cacheInvalidation.create({
      data: { zoneId, createdBy: userId, patterns, tags, status: 'pending' },
    });

    // EDD Section 4.4: the API returns 202/pending immediately; aggregation
    // of edge replies happens afterward, in the background.
    void this.collectAndFinalize(zoneId, invalidation.id, patterns, tags).catch(async (error: Error) => {
      this.logger.error(`invalidation ${invalidation.id} failed to finalize: ${error.message}`);
      await this.db.cacheInvalidation
        .update({ where: { id: invalidation.id }, data: { status: 'failed' } })
        .catch((updateError: Error) => {
          this.logger.error(`invalidation ${invalidation.id} could not even be marked failed: ${updateError.message}`);
        });
    });

    return { invalidationId: invalidation.id, status: invalidation.status };
  }

  async purgeAll(orgId: string, zoneId: string, userId: string | null) {
    return this.create(orgId, zoneId, userId, { patterns: ['*'], tags: [] });
  }

  async list(orgId: string, zoneId: string, skip: number, take: number) {
    await this.findOwnedZone(orgId, zoneId);
    const [invalidations, total] = await Promise.all([
      this.db.cacheInvalidation.findMany({ where: { zoneId }, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.cacheInvalidation.count({ where: { zoneId } }),
    ]);
    return { invalidations, total };
  }

  async getOne(orgId: string, zoneId: string, invalidationId: string): Promise<CacheInvalidation> {
    await this.findOwnedZone(orgId, zoneId);
    const invalidation = await this.db.cacheInvalidation.findUnique({ where: { id: invalidationId } });
    if (!invalidation || invalidation.zoneId !== zoneId) {
      throw new NotFoundException('Invalidation not found');
    }
    return invalidation;
  }

  private async collectAndFinalize(zoneId: string, invalidationId: string, patterns: string[], tags: string[]) {
    const replies = await this.events.requestMany<EdgeInvalidationReply>(
      `cache.invalidate.${zoneId}`,
      { zoneId, patterns, tags, invalidationId },
      REPLY_WINDOW_MS,
    );
    // At Phase 1's single-Edge-Proxy-replica scale, summing keysPurged
    // across replies is exact. Once multiple replicas of the same Edge
    // Proxy exist, every replica purges the SAME shared L2 (Redis) cache
    // independently and each reports its own L2 count in keysPurged, so
    // this sum double- (triple-, etc.) counts the shared L2 layer once per
    // replica. The result becomes an overcount of unique keys purged, not
    // incorrect purging — every replica's purge still succeeds. This is a
    // known, accepted limitation for now; a proper fix would need each Edge
    // Proxy to report per-layer counts so the CDN Service can count the
    // shared L2 layer only once across all replies.
    const keysPurged = replies.reduce((sum, reply) => sum + reply.keysPurged, 0);
    await this.db.cacheInvalidation.update({
      where: { id: invalidationId },
      data: { status: 'completed', edgesNotified: replies.length, keysPurged, completedAt: new Date() },
    });
  }

  private async findOwnedZone(orgId: string, zoneId: string): Promise<void> {
    const zone = await this.db.pullZone.findUnique({ where: { id: zoneId } });
    if (!zone || zone.orgId !== orgId) {
      throw new NotFoundException('Zone not found');
    }
  }
}
