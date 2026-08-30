import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DomainVerificationService } from './domain-verification.service.js';

@Injectable()
export class DomainVerificationCron {
  private readonly logger = new Logger(DomainVerificationCron.name);

  constructor(private readonly verification: DomainVerificationService) {}

  // EDD Section 5.8 / 6.2: "the Scheduler service performs a DNS lookup for
  // that domain every 30 seconds."
  @Cron('*/30 * * * * *')
  async handleCron(): Promise<void> {
    try {
      await this.verification.checkPending();
    } catch (error) {
      this.logger.error(`domain verification sweep failed: ${(error as Error).message}`);
    }
  }
}
