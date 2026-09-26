import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { RequireStorageScope, StorageScopeGuard } from '../auth/storage-scope.guard.js';
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
@UseGuards(AuthGuard, StorageScopeGuard)
export class ObjectsController {
  constructor(private readonly objects: ObjectsService) {}

  @Post('upload')
  @RequireStorageScope('write')
  initiateUpload(
    @AuthCtx() auth: CombinedAuthContext,
    @Param('bucketId') bucketId: string,
    @Body() dto: InitiateUploadDto,
  ) {
    return this.objects.initiateUpload(requireOrgId(auth), bucketId, dto);
  }

  @Get()
  @RequireStorageScope('read')
  list(@AuthCtx() auth: CombinedAuthContext, @Param('bucketId') bucketId: string, @Query() query: ListObjectsDto) {
    return this.objects.list(requireOrgId(auth), bucketId, query);
  }

  @Get(':key')
  @RequireStorageScope('read')
  get(@AuthCtx() auth: CombinedAuthContext, @Param('bucketId') bucketId: string, @Param('key') key: string) {
    return this.objects.getForOrg(requireOrgId(auth), bucketId, key);
  }

  // A share link exposes nothing a read-scoped caller can't already see, so
  // generating one needs read, not write.
  @Post(':key/sign')
  @HttpCode(200)
  @RequireStorageScope('read')
  sign(
    @AuthCtx() auth: CombinedAuthContext,
    @Param('bucketId') bucketId: string,
    @Param('key') key: string,
    @Body() dto: SignObjectDto,
  ) {
    return this.objects.sign(requireOrgId(auth), bucketId, key, dto);
  }

  @Delete(':key')
  @RequireStorageScope('delete')
  async remove(@AuthCtx() auth: CombinedAuthContext, @Param('bucketId') bucketId: string, @Param('key') key: string) {
    await this.objects.remove(requireOrgId(auth), bucketId, key);
    return { success: true };
  }
}
