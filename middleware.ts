import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './src/i18n/routing';

const intlMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  // Hanggent token fallback: redirect to hanggent-login API to set session cookie
  const hanggentToken = request.nextUrl.searchParams.get('hanggent_token');
  if (hanggentToken) {
    const redirectPath = request.nextUrl.pathname + request.nextUrl.search
      .replace(/[?&]hanggent_token=[^&]*/, '')
      .replace(/^&/, '?');
    const loginUrl = new URL('/api/auth/hanggent-login', request.url);
    loginUrl.searchParams.set('token', hanggentToken);
    loginUrl.searchParams.set('redirect', redirectPath || '/');
    return NextResponse.redirect(loginUrl);
  }

  return intlMiddleware(request);
}

export const config = {
    // 匹配所有路径，除了 api、_next/static、_next/image、favicon.ico 等
    matcher: [
        // 匹配所有路径
        '/((?!api|m|_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg|.*\\.gif|.*\\.ico).*)'
    ]
};
