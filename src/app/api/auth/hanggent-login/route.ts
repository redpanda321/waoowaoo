import { NextRequest, NextResponse } from 'next/server'
import { encode } from 'next-auth/jwt'
import * as jose from 'jose'
import { logAuthAction } from '@/lib/logging/semantic'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, getClientIp, AUTH_LOGIN_LIMIT } from '@/lib/rate-limit'

const HANGGENT_JWT_SECRET = process.env.HANGGENT_JWT_SECRET || ''
const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || ''

/**
 * GET /api/auth/hanggent-login?token=...&redirect=...
 *
 * Middleware fallback: verifies Hanggent JWT, creates NextAuth session cookie,
 * and redirects to the target page. Used when postMessage isn't available.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  const rateResult = await checkRateLimit('auth:hanggent-login', ip, AUTH_LOGIN_LIMIT)
  if (rateResult.limited) {
    return NextResponse.json(
      { success: false, message: `Too many requests` },
      { status: 429, headers: { 'Retry-After': String(rateResult.retryAfterSeconds) } },
    )
  }

  const token = request.nextUrl.searchParams.get('token')
  const redirect = request.nextUrl.searchParams.get('redirect') || '/'

  if (!HANGGENT_JWT_SECRET || !NEXTAUTH_SECRET || !token) {
    return NextResponse.redirect(new URL(redirect, request.url))
  }

  // Verify Hanggent JWT
  let payload: jose.JWTPayload
  try {
    const secret = new TextEncoder().encode(HANGGENT_JWT_SECRET)
    const result = await jose.jwtVerify(token, secret, { algorithms: ['HS256'] })
    payload = result.payload
  } catch {
    logAuthAction('HANGGENT_LOGIN', 'unknown', { error: 'Invalid token (GET fallback)' })
    return NextResponse.redirect(new URL(redirect, request.url))
  }

  const hanggentUserId = payload.id as number | undefined
  if (!hanggentUserId) {
    return NextResponse.redirect(new URL(redirect, request.url))
  }

  // Find or create user
  const hanggentName = `hanggent_${hanggentUserId}`
  let user = await prisma.user.findUnique({ where: { name: hanggentName } })

  if (!user) {
    user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: { name: hanggentName, password: null },
      })
      await tx.userBalance.create({
        data: { userId: newUser.id, balance: 0, frozenAmount: 0, totalSpent: 0 },
      })
      return newUser
    })
  }

  logAuthAction('HANGGENT_LOGIN', user.name, {
    userId: user.id,
    hanggentUserId,
    success: true,
    method: 'GET_FALLBACK',
  })

  // Create NextAuth session JWT and set cookie
  const sessionToken = await encode({
    token: { id: user.id, name: user.name, sub: user.id },
    secret: NEXTAUTH_SECRET,
  })

  const isSecure = (process.env.NEXTAUTH_URL || '').startsWith('https://')
  const cookieName = isSecure
    ? '__Secure-next-auth.session-token'
    : 'next-auth.session-token'

  const response = NextResponse.redirect(new URL(redirect, request.url))
  response.cookies.set(cookieName, sessionToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  })

  return response
}
