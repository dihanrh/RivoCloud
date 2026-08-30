import { Module } from '@nestjs/common';
import { RollupService } from './rollup.service.js';
import { RollupCron } from './rollup.cron.js';

@Module({
  providers: [RollupService, RollupCron],
})
export class AnalyticsRollupModule {}
