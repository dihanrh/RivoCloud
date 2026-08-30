import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { RequireZoneScope, ZoneScopeGuard } from '../auth/zone-scope.guard.js';
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
@UseGuards(AuthGuard, ZoneScopeGuard)
export class InvalidationsController {
  constructor(private readonly invalidations: InvalidationsService) {}

  @Post('invalidate')
  @HttpCode(202)
  @RequireZoneScope('invalidate')
  invalidate(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Body() dto: CreateInvalidationDto) {
    return this.invalidations.create(requireOrgId(auth), zoneId, auth.userId, dto);
  }

  @Post('purge')
  @HttpCode(202)
  @RequireZoneScope('invalidate')
  purge(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string) {
    return this.invalidations.purgeAll(requireOrgId(auth), zoneId, auth.userId);
  }

  @Get('invalidations')
  @RequireZoneScope('read')
  list(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Query() query: ListInvalidationsDto) {
    return this.invalidations.list(requireOrgId(auth), zoneId, query.skip ?? 0, query.take ?? 50);
  }

  @Get('invalidations/:invalidationId')
  @RequireZoneScope('read')
  getOne(
    @AuthCtx() auth: CombinedAuthContext,
    @Param('zoneId') zoneId: string,
    @Param('invalidationId') invalidationId: string,
  ) {
    return this.invalidations.getOne(requireOrgId(auth), zoneId, invalidationId);
  }
}
