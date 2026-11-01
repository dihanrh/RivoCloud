import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { AppModule } from '../app.module.js';
import { RequestLogWriter } from './request-log-writer.js';

describe('RequestLogWriter', () => {
  let app: INestApplication;
  let writer: RequestLogWriter;
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    writer = app.get(RequestLogWriter);
    ch = createClient({ url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123' });
  });

  afterAll(async () => {
    await ch.close();
    await app.close();
  });

  it('inserts a batch of events into request_logs', async () => {
    const zoneId = `test-zone-${Date.now()}`;
    await writer.insertBatch([
      {
        timestamp: new Date().toISOString(), zone_id: zoneId, org_id: 'org1', datacenter: 'dc1',
        method: 'GET', path: '/x', status_code: 200, cache_status: 'HIT',
        bytes_sent: 1234, duration_ms: 7, country: 'DE', client_ip_hash: 'hash1',
      },
    ]);

    const resultSet = await ch.query({
      query: 'SELECT * FROM request_logs WHERE zone_id = {zoneId:String}',
      query_params: { zoneId },
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json<{ zone_id: string; bytes_sent: string }>();
    expect(rows).toHaveLength(1);
    expect(rows[0].zone_id).toBe(zoneId);
    expect(Number(rows[0].bytes_sent)).toBe(1234);
  });

  it('is a no-op for an empty batch', async () => {
    await expect(writer.insertBatch([])).resolves.toBeUndefined();
  });
});
