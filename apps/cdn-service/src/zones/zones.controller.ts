import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { RequireZoneScope, ZoneScopeGuard } from '../auth/zone-scope.guard.js';
import { AuthCtx, type CombinedAuthContext } from '../auth/auth-context.decorator.js';
import { ZonesService } from './zones.service.js';
import { CreateZoneDto } from './dto/create-zone.dto.js';
import { UpdateZoneDto } from './dto/update-zone.dto.js';
import { ListZonesDto } from './dto/list-zones.dto.js';

function requireOrgId(auth: CombinedAuthContext): string {
  if (!auth.orgId) {
    throw new ForbiddenException('This credential is not scoped to an organization');
  }
  return auth.orgId;
}

@Controller('api/v1/zones')
@UseGuards(AuthGuard, ZoneScopeGuard)
export class ZonesController {
  constructor(private readonly zones: ZonesService) {}

  @Post()
  @RequireZoneScope('write')
  create(@AuthCtx() auth: CombinedAuthContext, @Body() dto: CreateZoneDto) {
    return this.zones.create(requireOrgId(auth), dto);
  }

  @Get()
  @RequireZoneScope('read')
  list(@AuthCtx() auth: CombinedAuthContext, @Query() query: ListZonesDto) {
    return this.zones.list(requireOrgId(auth), query.skip ?? 0, query.take ?? 50);
  }

  @Get(':zoneId')
  @RequireZoneScope('read')
  get(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string) {
    return this.zones.getForOrg(requireOrgId(auth), zoneId);
  }

  @Patch(':zoneId')
  @RequireZoneScope('write')
  update(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Body() dto: UpdateZoneDto) {
    return this.zones.update(requireOrgId(auth), zoneId, dto);
  }

  // Replaces the zone's signing secret — every outstanding signed URL for the
  // zone stops verifying as soon as edges pick up the republished config.
  @Post(':zoneId/signing-secret/rotate')
  @RequireZoneScope('write')
  rotateSigningSecret(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string) {
    return this.zones.rotateSigningSecret(requireOrgId(auth), zoneId);
  }

  @Delete(':zoneId')
  @RequireZoneScope('delete')
  async remove(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string) {
    await this.zones.remove(requireOrgId(auth), zoneId);
    return { success: true };
  }
}
