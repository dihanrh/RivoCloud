// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { ACCESS_COOKIE } from '@/lib/cookies';
import { config, middleware } from './middleware';

function run(path: string, withSession = false) {
  const request = new NextRequest(new URL(path, 'http://dashboard.test'), {
    headers: withSession ? { cookie: `${ACCESS_COOKIE}=token` } : {},
  });
  return middleware(request);
}

describe('middleware', () => {
  it.each(['/dashboard', '/zones/z1', '/storage', '/orgs', '/settings', '/analytics'])(
    'redirects %s to login without a session',
    (path) => {
      const response = run(path);
      expect(response.status).toBe(307);
      const location = new URL(response.headers.get('location')!);
      expect(location.pathname).toBe('/login');
      expect(location.searchParams.get('next')).toBe(path);
    },
  );

  it('lets a request with a session through', () => {
    expect(run('/settings', true).headers.get('location')).toBeNull();
  });

  it('leaves public pages alone', () => {
    expect(run('/login').headers.get('location')).toBeNull();
  });

  it('matches settings and analytics routes', () => {
    expect(config.matcher).toEqual(expect.arrayContaining(['/settings/:path*', '/analytics/:path*']));
  });
});
