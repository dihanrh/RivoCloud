import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { RollupCron, HOURLY_BANDWIDTH_ROLLUP_CRON } from './rollup.cron.js';
import type { RollupService } from './rollup.service.js';

// @nestjs/schedule's @Cron stores its options under this metadata key
// (SCHEDULE_CRON_OPTIONS in its schedule.constants, not a public export).
const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

describe('RollupCron', () => {
  it('runs the hourly rollup 5 minutes past the hour, leaving headroom for the ingestion flush lag', () => {
    expect(HOURLY_BANDWIDTH_ROLLUP_CRON).toBe('0 5 * * * *');
    const options = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, RollupCron.prototype.handleHourlyBandwidth);
    expect(options.cronTime).toBe(HOURLY_BANDWIDTH_ROLLUP_CRON);
  });

  it('delegates the hourly tick to RollupService.rollupBandwidthForPreviousHour', async () => {
    const rollupBandwidthForPreviousHour = vi.fn().mockResolvedValue(undefined);
    const cron = new RollupCron({ rollupBandwidthForPreviousHour } as unknown as RollupService);

    await cron.handleHourlyBandwidth();

    expect(rollupBandwidthForPreviousHour).toHaveBeenCalledOnce();
  });

  it('does not let a rejected hourly rollup crash the process', async () => {
    const rollupBandwidthForPreviousHour = vi.fn().mockRejectedValue(new Error('boom'));
    const cron = new RollupCron({ rollupBandwidthForPreviousHour } as unknown as RollupService);

    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(cron.handleHourlyBandwidth()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
    errorSpy.mockRestore();
  });

  it('delegates the daily tick to RollupService.rollupCountryForPreviousDay', async () => {
    const rollupCountryForPreviousDay = vi.fn().mockResolvedValue(undefined);
    const cron = new RollupCron({ rollupCountryForPreviousDay } as unknown as RollupService);

    await cron.handleDailyCountry();

    expect(rollupCountryForPreviousDay).toHaveBeenCalledOnce();
  });

  it('does not let a rejected daily rollup crash the process', async () => {
    const rollupCountryForPreviousDay = vi.fn().mockRejectedValue(new Error('boom'));
    const cron = new RollupCron({ rollupCountryForPreviousDay } as unknown as RollupService);

    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(cron.handleDailyCountry()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
    errorSpy.mockRestore();
  });
});
