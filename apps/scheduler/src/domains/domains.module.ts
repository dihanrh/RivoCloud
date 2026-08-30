import { Module } from '@nestjs/common';
import { DomainsInternalController } from './domains-internal.controller.js';
import { InternalAuthGuard } from './internal-auth.guard.js';
import { DomainVerificationService } from './domain-verification.service.js';
import { DomainVerificationCron } from './domain-verification.cron.js';

@Module({
  controllers: [DomainsInternalController],
  providers: [InternalAuthGuard, DomainVerificationService, DomainVerificationCron],
})
export class DomainsModule {}
