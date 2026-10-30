import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrgMemberGuard } from '../organizations/org-member.guard.js';
import { RolesGuard } from '../organizations/roles.guard.js';
import { AuditLogsController } from './audit-logs.controller.js';
import { AuditLogsService } from './audit-logs.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AuditLogsController],
  providers: [AuditLogsService, OrgMemberGuard, RolesGuard],
})
export class AuditLogsModule {}
