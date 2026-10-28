import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtOnlyGuard } from '../auth/jwt-only.guard.js';
import { OrgMemberGuard } from '../organizations/org-member.guard.js';
import { Roles, RolesGuard } from '../organizations/roles.guard.js';
import { AuditLogsService } from './audit-logs.service.js';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto.js';

@Controller('api/v1/orgs/:orgId/audit-logs')
@UseGuards(JwtOnlyGuard, OrgMemberGuard, RolesGuard)
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get()
  @Roles('owner', 'admin')
  async list(@Param('orgId') orgId: string, @Query() query: ListAuditLogsDto) {
    return this.auditLogs.list(orgId, query.limit, query.cursor);
  }
}
