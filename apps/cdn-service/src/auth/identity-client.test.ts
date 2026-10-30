import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { UnauthorizedException } from '@nestjs/common';
import { IdentityClient } from './identity-client.js';

describe('IdentityClient', () => {
  let server: Server;
  let baseUrl: string;
  let lastSecretHeader: string | undefined;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        lastSecretHeader = req.headers['x-internal-secret'] as string | undefined;
        const parsed = JSON.parse(body || '{}');
        if (req.url === '/internal/auth/verify-token') {
          if (parsed.token === 'valid-token') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ userId: 'u1', orgId: 'o1', role: 'owner' }));
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'Invalid or expired token' }));
          }
        } else if (req.url === '/internal/auth/verify-api-key') {
          if (parsed.apiKey === 'rc_valid') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ userId: 'u1', orgId: 'o1', apiKeyId: 'k1', permissions: ['zone:read'] }));
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'Invalid API key' }));
          }
        } else {
          res.writeHead(404);
          res.end();
        }
      });
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

  it('sends the internal secret header and parses a verified token', async () => {
    const client = new IdentityClient(baseUrl, 'test-secret');
    const identity = await client.verifyToken('valid-token');
    expect(identity).toEqual({ type: 'jwt', userId: 'u1', orgId: 'o1', role: 'owner' });
    expect(lastSecretHeader).toBe('test-secret');
  });

  it('throws UnauthorizedException for an invalid token', async () => {
    const client = new IdentityClient(baseUrl, 'test-secret');
    await expect(client.verifyToken('bad-token')).rejects.toThrow(UnauthorizedException);
  });

  it('parses a verified API key with its permissions', async () => {
    const client = new IdentityClient(baseUrl, 'test-secret');
    const identity = await client.verifyApiKey('rc_valid');
    expect(identity).toEqual({ type: 'api_key', userId: 'u1', orgId: 'o1', role: null, apiKeyId: 'k1', permissions: ['zone:read'] });
  });

  it('throws UnauthorizedException for an invalid API key', async () => {
    const client = new IdentityClient(baseUrl, 'test-secret');
    await expect(client.verifyApiKey('rc_bad')).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when identity-service is unreachable', async () => {
    const client = new IdentityClient('http://127.0.0.1:1', 'test-secret');
    await expect(client.verifyToken('valid-token')).rejects.toThrow(UnauthorizedException);
  });
});
