import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtOnlyGuard } from '../auth/jwt-only.guard.js';
import { AuthCtx, type AuthContext } from '../auth/auth-context.decorator.js';
import { ApiKeysService } from './api-keys.service.js';
import { CreateApiKeyDto } from './dto/create-api-key.dto.js';
import { UpdateApiKeyDto } from './dto/update-api-key.dto.js';

@Controller('api/v1/api-keys')
@UseGuards(JwtOnlyGuard)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  private requireOrg(auth: AuthContext): string {
    if (!auth.orgId) {
      throw new BadRequestException('Select an organization first (POST /api/v1/auth/select-org)');
    }
    return auth.orgId;
  }

  @Post()
  async create(@AuthCtx() auth: AuthContext, @Body() dto: CreateApiKeyDto) {
    const orgId = this.requireOrg(auth);
    return this.apiKeys.create(orgId, auth.userId, dto.name, dto.permissions, dto.testMode ?? false);
  }

  @Get()
  async list(@AuthCtx() auth: AuthContext) {
    const orgId = this.requireOrg(auth);
    return this.apiKeys.list(orgId);
  }

  @Patch(':keyId')
  async update(@AuthCtx() auth: AuthContext, @Param('keyId') keyId: string, @Body() dto: UpdateApiKeyDto) {
    const orgId = this.requireOrg(auth);
    return this.apiKeys.update(orgId, auth.userId, keyId, dto);
  }

  @Delete(':keyId')
  @HttpCode(200)
  async revoke(@AuthCtx() auth: AuthContext, @Param('keyId') keyId: string) {
    const orgId = this.requireOrg(auth);
    await this.apiKeys.revoke(orgId, keyId);
    return { success: true };
  }
}
