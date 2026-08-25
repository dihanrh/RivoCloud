import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { RequireStorageScope, StorageScopeGuard } from '../auth/storage-scope.guard.js';
import { AuthCtx, type CombinedAuthContext } from '../auth/auth-context.decorator.js';
import { BucketsService } from './buckets.service.js';
import { CreateBucketDto } from './dto/create-bucket.dto.js';
import { UpdateBucketDto } from './dto/update-bucket.dto.js';

function requireOrgId(auth: CombinedAuthContext): string {
  if (!auth.orgId) {
    throw new ForbiddenException('This credential is not scoped to an organization');
  }
  return auth.orgId;
}

@Controller('api/v1/buckets')
@UseGuards(AuthGuard, StorageScopeGuard)
export class BucketsController {
  constructor(private readonly buckets: BucketsService) {}

  @Post()
  @RequireStorageScope('write')
  create(@AuthCtx() auth: CombinedAuthContext, @Body() dto: CreateBucketDto) {
    return this.buckets.create(requireOrgId(auth), dto);
  }

  @Get()
  @RequireStorageScope('read')
  list(@AuthCtx() auth: CombinedAuthContext, @Query('skip') skip?: string, @Query('take') take?: string) {
    const parsedSkip = Math.max(0, Number(skip) || 0);
    const parsedTake = Math.min(100, Math.max(1, Number(take) || 50));
    return this.buckets.list(requireOrgId(auth), parsedSkip, parsedTake);
  }

  @Get(':bucketId')
  @RequireStorageScope('read')
  get(@AuthCtx() auth: CombinedAuthContext, @Param('bucketId') bucketId: string) {
    return this.buckets.getForOrg(requireOrgId(auth), bucketId);
  }

  @Patch(':bucketId')
  @RequireStorageScope('write')
  update(@AuthCtx() auth: CombinedAuthContext, @Param('bucketId') bucketId: string, @Body() dto: UpdateBucketDto) {
    return this.buckets.update(requireOrgId(auth), bucketId, dto);
  }

  @Delete(':bucketId')
  @RequireStorageScope('delete')
  async remove(@AuthCtx() auth: CombinedAuthContext, @Param('bucketId') bucketId: string) {
    await this.buckets.remove(requireOrgId(auth), bucketId);
    return { success: true };
  }
}
