import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CdnClient } from './cdn-client.js';

const STATUS_BY_PATH: Record<string, number> = {
  '/internal/zones/zone-ok/signed-urls': 200,
  '/internal/zones/zone-missing/signed-urls': 404,
  '/internal/zones/zone-unsigned/signed-urls': 409,
};

describe('CdnClient', () => {
  let server: Server;
  let baseUrl: string;
  let lastSecretHeader: string | undefined;
  let lastBody: unknown;

  beforeAll(async () => {
    server = createServer((req, res) => {
      lastSecretHeader = req.headers['x-internal-secret'] as string | undefined;
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        lastBody = raw ? JSON.parse(raw) : undefined;
        const status = STATUS_BY_PATH[req.url ?? ''] ?? 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(status === 200 ? JSON.stringify({ url: 'https://cdn.example.com/a.txt?expires=1&sig=abc' }) : '{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a network address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const body = { orgId: 'org-1', path: '/a.txt', expires: 1 };

  it('sends the internal secret and body, and returns the signed URL', async () => {
    const client = new CdnClient(baseUrl, 'internal-secret');
    await expect(client.signUrl('zone-ok', body)).resolves.toEqual({ url: 'https://cdn.example.com/a.txt?expires=1&sig=abc' });
    expect(lastSecretHeader).toBe('internal-secret');
    expect(lastBody).toEqual(body);
  });

  it('passes a 404 through as NotFoundException', async () => {
    await expect(new CdnClient(baseUrl, 's').signUrl('zone-missing', body)).rejects.toThrow(NotFoundException);
  });

  it('passes a 409 through as ConflictException', async () => {
    await expect(new CdnClient(baseUrl, 's').signUrl('zone-unsigned', body)).rejects.toThrow(ConflictException);
  });

  it('maps any other failure status to ServiceUnavailableException', async () => {
    await expect(new CdnClient(baseUrl, 's').signUrl('zone-broken', body)).rejects.toThrow(ServiceUnavailableException);
  });

  it('maps a network error to ServiceUnavailableException', async () => {
    await expect(new CdnClient('http://127.0.0.1:1', 's').signUrl('zone-ok', body)).rejects.toThrow(ServiceUnavailableException);
  });
});
