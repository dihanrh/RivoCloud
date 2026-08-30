import { describe, expect, it, vi } from 'vitest';
import { DomainVerificationCron } from './domain-verification.cron.js';
import type { DomainVerificationService } from './domain-verification.service.js';

describe('DomainVerificationCron', () => {
  it('delegates to DomainVerificationService.checkPending on each tick', async () => {
    const checkPending = vi.fn().mockResolvedValue({ checked: 2, transitioned: 1 });
    const cron = new DomainVerificationCron({ checkPending } as unknown as DomainVerificationService);

    await cron.handleCron();

    expect(checkPending).toHaveBeenCalledOnce();
  });

  it('does not let a rejected checkPending crash the process', async () => {
    const checkPending = vi.fn().mockRejectedValue(new Error('boom'));
    const cron = new DomainVerificationCron({ checkPending } as unknown as DomainVerificationService);

    await expect(cron.handleCron()).resolves.toBeUndefined();
  });
});
