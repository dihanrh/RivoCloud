import { describe, expect, it, vi } from 'vitest';
import { RollupCron } from './rollup.cron.js';
import type { RollupService } from './rollup.service.js';

describe('RollupCron', () => {
  it('delegates the hourly tick to RollupService.rollupBandwidthForPreviousHour', async () => {
    const rollupBandwidthForPreviousHour = vi.fn().mockResolvedValue(undefined);
    const cron = new RollupCron({ rollupBandwidthForPreviousHour } as unknown as RollupService);

    await cron.handleHourlyBandwidth();

    expect(rollupBandwidthForPreviousHour).toHaveBeenCalledOnce();
  });

  it('does not let a rejected hourly rollup crash the process', async () => {
    const rollupBandwidthForPreviousHour = vi.fn().mockRejectedValue(new Error('boom'));
    const cron = new RollupCron({ rollupBandwidthForPreviousHour } as unknown as RollupService);

    await expect(cron.handleHourlyBandwidth()).resolves.toBeUndefined();
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

    await expect(cron.handleDailyCountry()).resolves.toBeUndefined();
  });
});
