import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { AppModule } from '../app.module.js';

describe('EventsInternalController', () => {
  let app: INestApplication;
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    ch = createClient({ url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123' });
  });

  afterAll(async () => {
    await ch.close();
    await app.close();
  });

  it('rejects a request with no X-Internal-Secret header', async () => {
    const response = await request(app.getHttpServer()).post('/internal/analytics/events').send({ events: [] });
    expect(response.status).toBe(401);
  });

  it('ingests a batch of events with a valid secret', async () => {
    const zoneId = `internal-test-${Date.now()}`;
    const response = await request(app.getHttpServer())
      .post('/internal/analytics/events')
      .set('X-Internal-Secret', process.env.INTERNAL_API_SECRET ?? 'test_internal_secret_at_least_16_chars')
      .send({
        events: [
          {
            timestamp: '2026-06-29T10:00:00.000Z', zone_id: zoneId, org_id: 'org1', datacenter: 'dc1',
            method: 'GET', path: '/x', status_code: 200, cache_status: 'HIT',
            bytes_sent: 42, duration_ms: 1, country: 'DE', client_ip_hash: 'hash3',
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ingested: 1 });

    const resultSet = await ch.query({
      query: 'SELECT zone_id FROM request_logs WHERE zone_id = {zoneId:String}',
      query_params: { zoneId },
      format: 'JSONEachRow',
    });
    expect(await resultSet.json()).toHaveLength(1);
  });

  it.each(['USA', 'D', '1A', 'ÄÖ'])('rejects a batch containing a malformed country %j with a 400 and writes nothing', async (country) => {
    const zoneId = `internal-bad-country-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const baseEvent = {
      timestamp: '2026-06-29T10:00:00.000Z', zone_id: zoneId, org_id: 'org1', datacenter: 'dc1',
      method: 'GET', path: '/x', status_code: 200, cache_status: 'HIT',
      bytes_sent: 42, duration_ms: 1, client_ip_hash: 'hash3',
    };
    const response = await request(app.getHttpServer())
      .post('/internal/analytics/events')
      .set('X-Internal-Secret', process.env.INTERNAL_API_SECRET ?? 'test_internal_secret_at_least_16_chars')
      .send({ events: [{ ...baseEvent, country: 'DE' }, { ...baseEvent, country }] });

    expect(response.status).toBe(400);

    const resultSet = await ch.query({
      query: 'SELECT zone_id FROM request_logs WHERE zone_id = {zoneId:String}',
      query_params: { zoneId },
      format: 'JSONEachRow',
    });
    expect(await resultSet.json()).toHaveLength(0);
  });

  it('rejects a non-array events field with a 400', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/analytics/events')
      .set('X-Internal-Secret', process.env.INTERNAL_API_SECRET ?? 'test_internal_secret_at_least_16_chars')
      .send({
        events: {
          timestamp: '2026-06-29T10:00:00.000Z', zone_id: 'z1', org_id: 'org1', datacenter: 'dc1',
          method: 'GET', path: '/x', status_code: 200, cache_status: 'HIT',
          bytes_sent: 42, duration_ms: 1, country: 'DE', client_ip_hash: 'hash3',
        },
      });
    expect(response.status).toBe(400);
  });
});
