import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/cookies';

const PROTECTED_PREFIXES = ['/dashboard', '/zones', '/storage', '/analytics', '/settings', '/orgs'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!isProtected) return NextResponse.next();

  const hasSession = Boolean(request.cookies.get(ACCESS_COOKIE) ?? request.cookies.get(REFRESH_COOKIE));
  if (hasSession) return NextResponse.next();

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/zones/:path*',
    '/storage/:path*',
    '/analytics/:path*',
    '/settings/:path*',
    '/orgs/:path*',
  ],
};
