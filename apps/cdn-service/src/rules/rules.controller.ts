import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { Audit, RequireScope, ScopeGuard } from '@rivocloud/security';
import { AuthCtx, type CombinedAuthContext } from '../auth/auth-context.decorator.js';
import { RulesService } from './rules.service.js';
import { CreateCacheRuleDto } from './dto/create-rule.dto.js';
import { UpdateCacheRuleDto } from './dto/update-rule.dto.js';
import { ReorderRulesDto } from './dto/reorder-rules.dto.js';
import { ListRulesDto } from './dto/list-rules.dto.js';

function requireOrgId(auth: CombinedAuthContext): string {
  if (!auth.orgId) {
    throw new ForbiddenException('This credential is not scoped to an organization');
  }
  return auth.orgId;
}

@Controller('api/v1/zones/:zoneId/rules')
@UseGuards(AuthGuard, ScopeGuard)
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Post()
  @Audit('cache_rule.created', { resourceType: 'cache_rule', idPath: 'id' })
  @RequireScope('zone:write')
  create(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Body() dto: CreateCacheRuleDto) {
    return this.rules.create(requireOrgId(auth), zoneId, dto);
  }

  @Get()
  @RequireScope('zone:read')
  list(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Query() query: ListRulesDto) {
    return this.rules.list(requireOrgId(auth), zoneId, query.skip ?? 0, query.take ?? 50);
  }

  @Patch(':ruleId')
  @Audit('cache_rule.updated', { resourceType: 'cache_rule', idParam: 'ruleId' })
  @RequireScope('zone:write')
  update(
    @AuthCtx() auth: CombinedAuthContext,
    @Param('zoneId') zoneId: string,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateCacheRuleDto,
  ) {
    return this.rules.update(requireOrgId(auth), zoneId, ruleId, dto);
  }

  @Delete(':ruleId')
  @Audit('cache_rule.deleted', { resourceType: 'cache_rule', idParam: 'ruleId' })
  @RequireScope('zone:delete')
  async remove(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Param('ruleId') ruleId: string) {
    await this.rules.remove(requireOrgId(auth), zoneId, ruleId);
    return { success: true };
  }

  @Post('reorder')
  @Audit('cache_rule.reordered', { resourceType: 'zone', idParam: 'zoneId' })
  @RequireScope('zone:write')
  reorder(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Body() dto: ReorderRulesDto) {
    return this.rules.reorder(requireOrgId(auth), zoneId, dto.order);
  }
}
