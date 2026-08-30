import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RollupService } from './rollup.service.js';

@Injectable()
export class RollupCron {
  private readonly logger = new Logger(RollupCron.name);

  constructor(private readonly rollup: RollupService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourlyBandwidth(): Promise<void> {
    try {
      await this.rollup.rollupBandwidthForPreviousHour();
    } catch (error) {
      this.logger.error(`hourly bandwidth rollup failed: ${(error as Error).message}`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleDailyCountry(): Promise<void> {
    try {
      await this.rollup.rollupCountryForPreviousDay();
    } catch (error) {
      this.logger.error(`daily country rollup failed: ${(error as Error).message}`);
    }
  }
}
