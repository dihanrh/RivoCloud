import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { Audit, RequireScope, ScopeGuard } from '@rivocloud/security';
import { AuthCtx, type CombinedAuthContext } from '../auth/auth-context.decorator.js';
import { ObjectsService } from './objects.service.js';
import { InitiateUploadDto } from './dto/initiate-upload.dto.js';
import { ListObjectsDto } from './dto/list-objects.dto.js';
import { SignObjectDto } from './dto/sign-object.dto.js';

function requireOrgId(auth: CombinedAuthContext): string {
  if (!auth.orgId) {
    throw new ForbiddenException('This credential is not scoped to an organization');
  }
  return auth.orgId;
}

@Controller('api/v1/buckets/:bucketId/objects')
@UseGuards(AuthGuard, ScopeGuard)
export class ObjectsController {
  constructor(private readonly objects: ObjectsService) {}

  @Post('upload')
  @Audit('object.upload_initiated', { resourceType: 'bucket', idParam: 'bucketId', bodyFields: ['key', 'contentType'] })
  @RequireScope('storage:write')
  initiateUpload(
    @AuthCtx() auth: CombinedAuthContext,
    @Param('bucketId') bucketId: string,
    @Body() dto: InitiateUploadDto,
  ) {
    return this.objects.initiateUpload(requireOrgId(auth), bucketId, dto);
  }

  @Get()
  @RequireScope('storage:read')
  list(@AuthCtx() auth: CombinedAuthContext, @Param('bucketId') bucketId: string, @Query() query: ListObjectsDto) {
    return this.objects.list(requireOrgId(auth), bucketId, query);
  }

  @Get(':key')
  @RequireScope('storage:read')
  get(@AuthCtx() auth: CombinedAuthContext, @Param('bucketId') bucketId: string, @Param('key') key: string) {
    return this.objects.getForOrg(requireOrgId(auth), bucketId, key);
  }

  // A share link exposes nothing a read-scoped caller can't already see, so
  // generating one needs read, not write.
  @Post(':key/sign')
  @HttpCode(200)
  @Audit('object.signed_url_created', { resourceType: 'object', idParam: 'key', bodyFields: ['zoneId', 'expiresIn'] })
  @RequireScope('storage:read')
  sign(
    @AuthCtx() auth: CombinedAuthContext,
    @Param('bucketId') bucketId: string,
    @Param('key') key: string,
    @Body() dto: SignObjectDto,
  ) {
    return this.objects.sign(requireOrgId(auth), bucketId, key, dto);
  }

  @Delete(':key')
  @Audit('object.deleted', { resourceType: 'object', idParam: 'key' })
  @RequireScope('storage:delete')
  async remove(@AuthCtx() auth: CombinedAuthContext, @Param('bucketId') bucketId: string, @Param('key') key: string) {
    await this.objects.remove(requireOrgId(auth), bucketId, key);
    return { success: true };
  }
}
