import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { IngestionService } from './ingestion.service.js';
import type { RequestLogWriter } from './request-log-writer.js';

// Minimal fake matching the shape consume() needs from a nats Subscription:
// an async-iterable whose iteration rejects, simulating an abrupt connection
// failure rather than a graceful unsubscribe()/close().
function makeBrokenSubscription(): AsyncIterable<{ data: Uint8Array }> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<{ data: Uint8Array }>> {
          return Promise.reject(new Error('connection lost'));
        },
      };
    },
  };
}

function makeEvent() {
  return {
    timestamp: '2026-06-29T10:00:00Z', zone_id: 'z1', org_id: 'o1', datacenter: 'dc1',
    method: 'GET', path: '/x', status_code: 200, cache_status: 'HIT',
    bytes_sent: 100, duration_ms: 5, country: 'DE', client_ip_hash: 'abc',
  };
}

describe('IngestionService', () => {
  it('flushes once the buffer reaches 1000 events', () => {
    const insertBatch = vi.fn().mockResolvedValue(undefined);
    const service = new IngestionService('nats://unused', { insertBatch } as unknown as RequestLogWriter);
    for (let i = 0; i < 999; i++) service.enqueue(makeEvent());
    expect(insertBatch).not.toHaveBeenCalled();
    service.enqueue(makeEvent());
    expect(insertBatch).toHaveBeenCalledOnce();
    expect(insertBatch.mock.calls[0][0]).toHaveLength(1000);
  });

  it('flush() is a no-op with an empty buffer', async () => {
    const insertBatch = vi.fn();
    const service = new IngestionService('nats://unused', { insertBatch } as unknown as RequestLogWriter);
    await service.flush();
    expect(insertBatch).not.toHaveBeenCalled();
  });

  it('a failed insertBatch does not throw out of flush', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const insertBatch = vi.fn().mockRejectedValue(new Error('clickhouse down'));
    const service = new IngestionService('nats://unused', { insertBatch } as unknown as RequestLogWriter);
    service.enqueue(makeEvent());
    await expect(service.flush()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('clickhouse down'));
    errorSpy.mockRestore();
  });

  it('a subscription iterator that rejects does not throw out of consume()', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const insertBatch = vi.fn();
    const service = new IngestionService('nats://unused', { insertBatch } as unknown as RequestLogWriter);
    const consume = (service as unknown as { consume(sub: AsyncIterable<{ data: Uint8Array }>): Promise<void> })
      .consume.bind(service);

    await expect(consume(makeBrokenSubscription())).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('connection lost'));

    errorSpy.mockRestore();
  });

  it('reports ingestion as not connected before any NATS connection exists', () => {
    const service = new IngestionService('nats://unused', { insertBatch: vi.fn() } as unknown as RequestLogWriter);
    expect(service.health()).toEqual({ natsConnected: false, lastConnectedAt: null });
  });

  it('an unreachable NATS at startup does not fail bootstrap, logs a distinct warning, and shuts down cleanly', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // Nothing listens on port 1, so the first connect fails fast.
    const service = new IngestionService('nats://127.0.0.1:1', { insertBatch: vi.fn() } as unknown as RequestLogWriter);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('INGESTION UNHEALTHY'));
    expect(service.health().natsConnected).toBe(false);

    // The background retry loop must be cancellable: destroy resolves
    // promptly instead of leaving a dial loop running.
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();

    warnSpy.mockRestore();
  });
});
