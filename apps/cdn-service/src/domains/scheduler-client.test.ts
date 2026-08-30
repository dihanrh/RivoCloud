import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { ServiceUnavailableException } from '@nestjs/common';
import { SchedulerClient } from './scheduler-client.js';

describe('SchedulerClient', () => {
  let server: Server;
  let baseUrl: string;
  let lastSecretHeader: string | undefined;
  let lastPath: string | undefined;

  beforeAll(async () => {
    server = createServer((req, res) => {
      lastSecretHeader = req.headers['x-internal-secret'] as string | undefined;
      lastPath = req.url;
      if (req.url === '/internal/domains/domain-1/verify-now') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'domain-1', sslStatus: 'pending_ssl', sslError: null }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a network address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('posts to the internal verify-now endpoint with the internal secret header', async () => {
    const client = new SchedulerClient(baseUrl, 'test-secret');
    const result = await client.verifyDomainNow('domain-1');
    expect(result).toEqual({ id: 'domain-1', sslStatus: 'pending_ssl', sslError: null });
    expect(lastSecretHeader).toBe('test-secret');
    expect(lastPath).toBe('/internal/domains/domain-1/verify-now');
  });

  it('throws ServiceUnavailableException for an unknown domain', async () => {
    const client = new SchedulerClient(baseUrl, 'test-secret');
    await expect(client.verifyDomainNow('missing')).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws ServiceUnavailableException when the Scheduler is unreachable', async () => {
    const client = new SchedulerClient('http://127.0.0.1:1', 'test-secret');
    await expect(client.verifyDomainNow('domain-1')).rejects.toThrow(ServiceUnavailableException);
  });
});
