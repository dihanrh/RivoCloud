import { Module } from '@nestjs/common';
import { ObjectsController } from './objects.controller.js';
import { ObjectsService } from './objects.service.js';
import { MinioWebhookController } from './minio-webhook.controller.js';
import { MinioWebhookAuthGuard } from './minio-webhook-auth.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { BucketsModule } from '../buckets/buckets.module.js';

@Module({
  imports: [AuthModule, BucketsModule],
  controllers: [ObjectsController, MinioWebhookController],
  providers: [ObjectsService, MinioWebhookAuthGuard],
})
export class ObjectsModule {}
