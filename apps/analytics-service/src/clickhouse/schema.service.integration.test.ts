import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient } from '@clickhouse/client';
import { AppModule } from '../app.module.js';

describe('SchemaService', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates all three tables on boot', async () => {
    const client = createClient({ url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123' });
    for (const table of ['request_logs', 'bandwidth_hourly', 'requests_by_country_daily']) {
      const resultSet = await client.query({ query: `EXISTS TABLE ${table}`, format: 'JSONEachRow' });
      const [row] = await resultSet.json<{ result: number }>();
      expect(row.result).toBe(1);
    }
    await client.close();
  });

  it("buckets bandwidth_hourly.hour in UTC, like request_logs.timestamp", async () => {
    const client = createClient({ url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123' });
    const resultSet = await client.query({
      query: "SELECT type FROM system.columns WHERE database = currentDatabase() AND table = 'bandwidth_hourly' AND name = 'hour'",
      format: 'JSONEachRow',
    });
    expect(await resultSet.json()).toEqual([{ type: "DateTime('UTC')" }]);
    await client.close();
  });
});
