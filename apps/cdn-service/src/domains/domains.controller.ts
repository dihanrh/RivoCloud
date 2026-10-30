import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { Audit, RequireScope, ScopeGuard } from '@rivocloud/security';
import { AuthCtx, type CombinedAuthContext } from '../auth/auth-context.decorator.js';
import { DomainsService } from './domains.service.js';
import { SchedulerClient } from './scheduler-client.js';
import { CreateDomainDto } from './dto/create-domain.dto.js';

function requireOrgId(auth: CombinedAuthContext): string {
  if (!auth.orgId) {
    throw new ForbiddenException('This credential is not scoped to an organization');
  }
  return auth.orgId;
}

@Controller('api/v1/zones/:zoneId/domains')
@UseGuards(AuthGuard, ScopeGuard)
export class DomainsController {
  constructor(
    private readonly domains: DomainsService,
    private readonly scheduler: SchedulerClient,
  ) {}

  @Post()
  @Audit('domain.created', { resourceType: 'domain', idPath: 'id', bodyFields: ['domain'] })
  @RequireScope('zone:write')
  create(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Body() dto: CreateDomainDto) {
    return this.domains.create(requireOrgId(auth), zoneId, dto);
  }

  @Get()
  @RequireScope('zone:read')
  list(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string) {
    return this.domains.list(requireOrgId(auth), zoneId);
  }

  @Delete(':domainId')
  @Audit('domain.deleted', { resourceType: 'domain', idParam: 'domainId' })
  @RequireScope('zone:delete')
  async remove(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Param('domainId') domainId: string) {
    await this.domains.remove(requireOrgId(auth), zoneId, domainId);
    return { success: true };
  }

  @Post(':domainId/verify')
  @Audit('domain.verification_requested', { resourceType: 'domain', idParam: 'domainId' })
  @RequireScope('zone:write')
  async verify(
    @AuthCtx() auth: CombinedAuthContext,
    @Param('zoneId') zoneId: string,
    @Param('domainId') domainId: string,
  ) {
    await this.domains.findOwnedDomain(requireOrgId(auth), zoneId, domainId);
    return this.scheduler.verifyDomainNow(domainId);
  }
}
