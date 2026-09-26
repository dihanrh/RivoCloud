import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RollupService } from './rollup.service.js';

// second minute hour day-of-month month day-of-week: 5 minutes past every hour.
export const HOURLY_BANDWIDTH_ROLLUP_CRON = '0 5 * * * *';

@Injectable()
export class RollupCron {
  private readonly logger = new Logger(RollupCron.name);

  constructor(private readonly rollup: RollupService) {}

  // Fires at :05 past every hour, not exactly on :00. analytics-service
  // buffers edge.request events in memory for up to 5s before flushing them
  // to request_logs (and an event's timestamp is its request's *start* time),
  // so at :00:00 the last moments of the previous hour may not have landed
  // yet — and a later re-run can't safely catch them up (see
  // RollupService.rollupBandwidthForPreviousHour). Five minutes gives that
  // flush lag plus in-flight requests ample headroom. The previous-hour
  // window is still computed from "now", so a 14:05 run rolls up [13:00, 14:00).
  @Cron(HOURLY_BANDWIDTH_ROLLUP_CRON)
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
