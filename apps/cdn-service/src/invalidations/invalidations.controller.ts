import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { Audit, RATE_LIMITS, RateLimit, RequireScope, ScopeGuard } from '@rivocloud/security';
import { AuthCtx, type CombinedAuthContext } from '../auth/auth-context.decorator.js';
import { InvalidationsService } from './invalidations.service.js';
import { CreateInvalidationDto } from './dto/create-invalidation.dto.js';
import { ListInvalidationsDto } from './dto/list-invalidations.dto.js';

function requireOrgId(auth: CombinedAuthContext): string {
  if (!auth.orgId) {
    throw new ForbiddenException('This credential is not scoped to an organization');
  }
  return auth.orgId;
}

@Controller('api/v1/zones/:zoneId/cache')
@UseGuards(AuthGuard, ScopeGuard)
export class InvalidationsController {
  constructor(private readonly invalidations: InvalidationsService) {}

  @Post('invalidate')
  @HttpCode(202)
  @Audit('cache.invalidated', { resourceType: 'zone', idParam: 'zoneId', bodyFields: ['patterns', 'tags'] })
  @RateLimit(RATE_LIMITS.cacheInvalidation)
  @RequireScope('cache:invalidate')
  invalidate(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Body() dto: CreateInvalidationDto) {
    return this.invalidations.create(requireOrgId(auth), zoneId, auth.userId, dto);
  }

  @Post('purge')
  @HttpCode(202)
  @Audit('cache.purged', { resourceType: 'zone', idParam: 'zoneId' })
  @RateLimit(RATE_LIMITS.cacheInvalidation)
  @RequireScope('cache:invalidate')
  purge(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string) {
    return this.invalidations.purgeAll(requireOrgId(auth), zoneId, auth.userId);
  }

  @Get('invalidations')
  @RequireScope('zone:read')
  list(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Query() query: ListInvalidationsDto) {
    return this.invalidations.list(requireOrgId(auth), zoneId, query.skip ?? 0, query.take ?? 50);
  }

  @Get('invalidations/:invalidationId')
  @RequireScope('zone:read')
  getOne(
    @AuthCtx() auth: CombinedAuthContext,
    @Param('zoneId') zoneId: string,
    @Param('invalidationId') invalidationId: string,
  ) {
    return this.invalidations.getOne(requireOrgId(auth), zoneId, invalidationId);
  }
}
