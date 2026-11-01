import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEnv } from './env';

const REQUIRED = {
  IDENTITY_SERVICE_URL: 'http://localhost:3001',
  CDN_SERVICE_URL: 'http://localhost:3003',
  STORAGE_SERVICE_URL: 'http://localhost:3004',
  ANALYTICS_SERVICE_URL: 'http://localhost:3006',
};

describe('getEnv', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env = { ...original, ...REQUIRED };
  });

  afterEach(() => {
    process.env = original;
  });

  it('parses valid service URLs', () => {
    expect(getEnv()).toMatchObject(REQUIRED);
  });

  it('throws with a readable message when a URL is missing', () => {
    delete process.env.CDN_SERVICE_URL;
    expect(() => getEnv()).toThrow(/CDN_SERVICE_URL/);
  });

  it('defaults the service URLs in demo mode (RIVO_DEMO_BACKEND=mock)', () => {
    for (const key of Object.keys(REQUIRED)) delete process.env[key];
    process.env.RIVO_DEMO_BACKEND = 'mock';
    expect(getEnv()).toMatchObject({ IDENTITY_SERVICE_URL: 'http://mock.identity', CDN_SERVICE_URL: 'http://mock.cdn' });
  });

  it('keeps strict validation outside demo mode', () => {
    delete process.env.RIVO_DEMO_BACKEND;
    delete process.env.IDENTITY_SERVICE_URL;
    expect(() => getEnv()).toThrow(/IDENTITY_SERVICE_URL/);
  });
});
