import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { OrgRole } from '@rivocloud/security';
import { JwtOnlyGuard } from '../auth/jwt-only.guard.js';
import { AuthCtx, type AuthContext } from '../auth/auth-context.decorator.js';
import { OrganizationsService } from './organizations.service.js';
import { OrgMemberGuard } from './org-member.guard.js';
import { RolesGuard, Roles } from './roles.guard.js';
import { CreateOrgDto } from './dto/create-org.dto.js';
import { UpdateOrgDto } from './dto/update-org.dto.js';
import { AddMemberDto } from './dto/add-member.dto.js';
import { UpdateMemberDto } from './dto/update-member.dto.js';
import { AuthService } from '../auth/auth.service.js';

@Controller('api/v1/orgs')
@UseGuards(JwtOnlyGuard, OrgMemberGuard, RolesGuard)
export class OrganizationsController {
  constructor(
    private readonly orgs: OrganizationsService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  async create(@AuthCtx() authCtx: AuthContext, @Body() dto: CreateOrgDto) {
    const org = await this.orgs.create(authCtx.userId, dto.name);
    const tokens = await this.auth.selectOrg(authCtx.userId, org.id);
    return { organization: org, ...tokens };
  }

  @Get()
  async list(@AuthCtx() authCtx: AuthContext) {
    return this.orgs.listForUser(authCtx.userId);
  }

  @Get(':orgId')
  async get(@Param('orgId') orgId: string) {
    return this.orgs.get(orgId);
  }

  @Patch(':orgId')
  @Roles('owner', 'admin')
  async update(@Param('orgId') orgId: string, @Body() dto: UpdateOrgDto) {
    return this.orgs.update(orgId, dto);
  }

  @Delete(':orgId')
  @Roles('owner')
  async remove(@Param('orgId') orgId: string) {
    await this.orgs.delete(orgId);
    return { success: true };
  }

  @Get(':orgId/members')
  async listMembers(@Param('orgId') orgId: string) {
    return this.orgs.listMembers(orgId);
  }

  @Post(':orgId/members')
  @Roles('owner', 'admin')
  async addMember(
    @AuthCtx() authCtx: AuthContext,
    @Req() req: { orgRole: OrgRole },
    @Param('orgId') orgId: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.orgs.addMember(orgId, authCtx.userId, req.orgRole, dto.email, dto.role);
  }

  @Patch(':orgId/members/:userId')
  @Roles('owner')
  async updateMember(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.orgs.updateMemberRole(orgId, userId, dto.role);
  }

  @Delete(':orgId/members/:userId')
  @Roles('owner', 'admin')
  async removeMember(@Req() req: { orgRole: OrgRole }, @Param('orgId') orgId: string, @Param('userId') userId: string) {
    await this.orgs.removeMember(orgId, req.orgRole, userId);
    return { success: true };
  }
}
