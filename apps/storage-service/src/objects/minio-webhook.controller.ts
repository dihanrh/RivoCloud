import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { NoAudit } from '@rivocloud/security';
import { MinioWebhookAuthGuard } from './minio-webhook-auth.guard.js';
import { ObjectsService } from './objects.service.js';

interface MinioNotificationBody {
  Records?: Array<{
    s3: { bucket: { name: string }; object: { key: string; size: number; eTag: string } };
  }>;
}

@NoAudit()
@Controller('internal/storage')
export class MinioWebhookController {
  constructor(private readonly objects: ObjectsService) {}

  @Post('minio-webhook')
  @UseGuards(MinioWebhookAuthGuard)
  async handleWebhook(@Body() body: MinioNotificationBody) {
    for (const record of body.Records ?? []) {
      await this.objects.markUploaded(record);
    }
    return { received: true };
  }
}
