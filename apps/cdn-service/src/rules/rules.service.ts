import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CacheRule, PrismaClient } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { RulesConfigPublisher } from './rules-config.publisher.js';
import type { CreateCacheRuleDto } from './dto/create-rule.dto.js';
import type { UpdateCacheRuleDto } from './dto/update-rule.dto.js';

@Injectable()
export class RulesService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly publisher: RulesConfigPublisher,
  ) {}

  async create(orgId: string, zoneId: string, dto: CreateCacheRuleDto): Promise<CacheRule> {
    await this.findOwnedZone(orgId, zoneId);
    this.assertQueryWhitelistPresence(dto.queryString, dto.queryWhitelist);
    const rule = await this.db.cacheRule.create({
      data: {
        zoneId,
        pattern: dto.pattern,
        patternType: dto.patternType ?? 'glob',
        action: dto.action ?? 'cache',
        edgeTtl: dto.edgeTtl,
        browserTtl: dto.browserTtl,
        queryString: dto.queryString ?? 'strip_all',
        queryWhitelist: dto.queryWhitelist ?? [],
        priority: dto.priority ?? 0,
      },
    });
    await this.publisher.publish(zoneId);
    return rule;
  }

  async list(orgId: string, zoneId: string, skip: number, take: number) {
    await this.findOwnedZone(orgId, zoneId);
    const [rules, total] = await Promise.all([
      this.db.cacheRule.findMany({ where: { zoneId }, skip, take, orderBy: { priority: 'desc' } }),
      this.db.cacheRule.count({ where: { zoneId } }),
    ]);
    return { rules, total };
  }

  async update(orgId: string, zoneId: string, ruleId: string, dto: UpdateCacheRuleDto): Promise<CacheRule> {
    await this.findOwnedRule(orgId, zoneId, ruleId);
    this.assertQueryWhitelistPresence(dto.queryString, dto.queryWhitelist);
    const rule = await this.db.cacheRule.update({
      where: { id: ruleId },
      data: {
        ...(dto.pattern !== undefined && { pattern: dto.pattern }),
        ...(dto.patternType !== undefined && { patternType: dto.patternType }),
        ...(dto.action !== undefined && { action: dto.action }),
        ...(dto.edgeTtl !== undefined && { edgeTtl: dto.edgeTtl }),
        ...(dto.browserTtl !== undefined && { browserTtl: dto.browserTtl }),
        ...(dto.queryString !== undefined && { queryString: dto.queryString }),
        ...(dto.queryWhitelist !== undefined && { queryWhitelist: dto.queryWhitelist }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
      },
    });
    await this.publisher.publish(zoneId);
    return rule;
  }

  async remove(orgId: string, zoneId: string, ruleId: string): Promise<void> {
    await this.findOwnedRule(orgId, zoneId, ruleId);
    await this.db.cacheRule.delete({ where: { id: ruleId } });
    await this.publisher.publish(zoneId);
  }

  async reorder(orgId: string, zoneId: string, order: string[]) {
    await this.findOwnedZone(orgId, zoneId);
    const rules = await this.db.cacheRule.findMany({ where: { zoneId } });
    const ruleIds = new Set(rules.map((r) => r.id));
    if (order.length !== rules.length || !order.every((id) => ruleIds.has(id))) {
      throw new BadRequestException("order must contain exactly the zone's existing rule ids");
    }
    await this.db.$transaction(
      order.map((id, index) =>
        this.db.cacheRule.update({ where: { id }, data: { priority: order.length - 1 - index } }),
      ),
    );
    await this.publisher.publish(zoneId);
    return this.list(orgId, zoneId, 0, 100);
  }

  private assertQueryWhitelistPresence(queryString?: string, whitelist?: string[]): void {
    if (queryString === 'whitelist' && (!whitelist || whitelist.length === 0)) {
      throw new BadRequestException('queryWhitelist is required when queryString is "whitelist"');
    }
  }

  private async findOwnedZone(orgId: string, zoneId: string): Promise<void> {
    const zone = await this.db.pullZone.findUnique({ where: { id: zoneId } });
    if (!zone || zone.orgId !== orgId) {
      throw new NotFoundException('Zone not found');
    }
  }

  private async findOwnedRule(orgId: string, zoneId: string, ruleId: string): Promise<CacheRule> {
    await this.findOwnedZone(orgId, zoneId);
    const rule = await this.db.cacheRule.findUnique({ where: { id: ruleId } });
    if (!rule || rule.zoneId !== zoneId) {
      throw new NotFoundException('Cache rule not found');
    }
    return rule;
  }
}
