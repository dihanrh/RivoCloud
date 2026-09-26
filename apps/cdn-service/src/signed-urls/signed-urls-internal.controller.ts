import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { InternalAuthGuard } from './internal-auth.guard.js';
import { SignedUrlsService } from './signed-urls.service.js';
import { SignUrlInternalDto } from './dto/sign-url-internal.dto.js';

// Called by the Storage Service's POST /buckets/:id/objects/:key/sign (EDD
// Section 11, step 10.1). Signing lives here rather than there because the
// secret belongs to the zone: this keeps the encryption key and the
// decrypted secret inside the CDN Service.
@Controller('internal/zones')
@UseGuards(InternalAuthGuard)
export class SignedUrlsInternalController {
  constructor(private readonly signedUrls: SignedUrlsService) {}

  @Post(':zoneId/signed-urls')
  @HttpCode(200)
  sign(@Param('zoneId', ParseUUIDPipe) zoneId: string, @Body() dto: SignUrlInternalDto) {
    return this.signedUrls.sign(zoneId, dto);
  }
}
