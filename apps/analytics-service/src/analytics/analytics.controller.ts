import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { AnalyticsAccessGuard } from '../auth/analytics-access.guard.js';
import { AuthCtx, type CombinedAuthContext } from '../auth/auth-context.decorator.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsQueryDto } from './dto/analytics-query.dto.js';

function requireOrgId(auth: CombinedAuthContext): string {
  if (!auth.orgId) {
    throw new ForbiddenException('This credential is not scoped to an organization');
  }
  return auth.orgId;
}

@Controller('api/v1/analytics')
@UseGuards(AuthGuard, AnalyticsAccessGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(@AuthCtx() auth: CombinedAuthContext, @Query() query: AnalyticsQueryDto) {
    return this.analytics.overview(requireOrgId(auth), query);
  }

  @Get('bandwidth')
  bandwidth(@AuthCtx() auth: CombinedAuthContext, @Query() query: AnalyticsQueryDto) {
    return this.analytics.bandwidth(requireOrgId(auth), query);
  }

  @Get('requests')
  requests(@AuthCtx() auth: CombinedAuthContext, @Query() query: AnalyticsQueryDto) {
    return this.analytics.requests(requireOrgId(auth), query);
  }

  @Get('cache')
  cache(@AuthCtx() auth: CombinedAuthContext, @Query() query: AnalyticsQueryDto) {
    return this.analytics.cache(requireOrgId(auth), query);
  }

  @Get('geography')
  geography(@AuthCtx() auth: CombinedAuthContext, @Query() query: AnalyticsQueryDto) {
    return this.analytics.geography(requireOrgId(auth), query);
  }

  @Get('latency')
  latency(@AuthCtx() auth: CombinedAuthContext, @Query() query: AnalyticsQueryDto) {
    return this.analytics.latency(requireOrgId(auth), query);
  }

  @Get('status-codes')
  statusCodes(@AuthCtx() auth: CombinedAuthContext, @Query() query: AnalyticsQueryDto) {
    return this.analytics.statusCodes(requireOrgId(auth), query);
  }

  @Get('top-paths')
  topPaths(@AuthCtx() auth: CombinedAuthContext, @Query() query: AnalyticsQueryDto) {
    return this.analytics.topPaths(requireOrgId(auth), query);
  }
}
