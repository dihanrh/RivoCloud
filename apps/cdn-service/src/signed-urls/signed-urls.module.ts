import { Module } from '@nestjs/common';
import { SignedUrlsInternalController } from './signed-urls-internal.controller.js';
import { SignedUrlsService } from './signed-urls.service.js';
import { InternalAuthGuard } from './internal-auth.guard.js';

@Module({
  controllers: [SignedUrlsInternalController],
  providers: [SignedUrlsService, InternalAuthGuard],
})
export class SignedUrlsModule {}
