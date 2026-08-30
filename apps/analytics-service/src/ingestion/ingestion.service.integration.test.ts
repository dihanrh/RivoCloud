import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { connect, type NatsConnection } from 'nats';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { AppModule } from '../app.module.js';
import { IngestionService } from './ingestion.service.js';

describe('IngestionService (NATS -> ClickHouse)', () => {
  let app: INestApplication;
  let nc: NatsConnection;
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    nc = await connect({ servers: process.env.NATS_URL ?? 'nats://localhost:4222' });
    ch = createClient({ url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123' });
  });

  afterAll(async () => {
    await nc.close();
    await ch.close();
    await app.close();
  });

  it('ingests a published edge.request event and flushes it on demand', async () => {
    const zoneId = `ingest-test-${Date.now()}`;
    const payload = {
      timestamp: '2026-06-29T10:00:00.000Z', zone_id: zoneId, org_id: 'org1', datacenter: 'dc1',
      method: 'GET', path: '/x', status_code: 200, cache_status: 'HIT',
      bytes_sent: 500, duration_ms: 3, country: 'FR', client_ip_hash: 'hash2',
    };
    nc.publish('edge.request', new TextEncoder().encode(JSON.stringify(payload)));

    // Give the subscription's async iterator a tick to receive the message,
    // then force a flush rather than waiting the full 5s interval.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await app.get(IngestionService).flush();

    const resultSet = await ch.query({
      query: 'SELECT zone_id FROM request_logs WHERE zone_id = {zoneId:String}',
      query_params: { zoneId },
      format: 'JSONEachRow',
    });
    expect(await resultSet.json()).toHaveLength(1);
  });
});
