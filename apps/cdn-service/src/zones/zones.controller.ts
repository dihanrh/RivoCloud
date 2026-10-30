import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { Audit, RequireScope, ScopeGuard } from '@rivocloud/security';
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
@UseGuards(AuthGuard, ScopeGuard)
export class ZonesController {
  constructor(private readonly zones: ZonesService) {}

  @Post()
  @Audit('zone.created', { resourceType: 'zone', idPath: 'id' })
  @RequireScope('zone:write')
  create(@AuthCtx() auth: CombinedAuthContext, @Body() dto: CreateZoneDto) {
    return this.zones.create(requireOrgId(auth), dto);
  }

  @Get()
  @RequireScope('zone:read')
  list(@AuthCtx() auth: CombinedAuthContext, @Query() query: ListZonesDto) {
    return this.zones.list(requireOrgId(auth), query.skip ?? 0, query.take ?? 50);
  }

  @Get(':zoneId')
  @RequireScope('zone:read')
  get(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string) {
    return this.zones.getForOrg(requireOrgId(auth), zoneId);
  }

  @Patch(':zoneId')
  @Audit('zone.updated', {
    resourceType: 'zone',
    idParam: 'zoneId',
    bodyFields: ['name', 'originUrl', 'originProtocol', 'cacheTtl', 'browserTtl', 'enabled', 'signedUrlsRequired'],
  })
  @RequireScope('zone:write')
  update(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Body() dto: UpdateZoneDto) {
    return this.zones.update(requireOrgId(auth), zoneId, dto);
  }

  // Replaces the zone's signing secret — every outstanding signed URL for the
  // zone stops verifying as soon as edges pick up the republished config.
  @Post(':zoneId/signing-secret/rotate')
  @Audit('zone.signing_secret_rotated', { resourceType: 'zone', idParam: 'zoneId' })
  @RequireScope('zone:write')
  rotateSigningSecret(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string) {
    return this.zones.rotateSigningSecret(requireOrgId(auth), zoneId);
  }

  @Delete(':zoneId')
  @Audit('zone.deleted', { resourceType: 'zone', idParam: 'zoneId' })
  @RequireScope('zone:delete')
  async remove(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string) {
    await this.zones.remove(requireOrgId(auth), zoneId);
    return { success: true };
  }
}
