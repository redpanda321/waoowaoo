import { PrismaAdapter } from "@next-auth/prisma-adapter"
import CredentialsProvider from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import * as jose from 'jose'
import { logAuthAction } from './logging/semantic'
import { prisma } from './prisma'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const authOptions: any = {
  adapter: PrismaAdapter(prisma),
  // 🔥 允许从任意 Host 访问（解决局域网访问问题）
  trustHost: true,
  // 🔥 根据 URL 协议决定是否使用 Secure Cookie
  // 局域网 HTTP 访问时需要关闭，否则 Cookie 无法设置
  useSecureCookies: (process.env.NEXTAUTH_URL || '').startsWith('https://'),
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          logAuthAction('LOGIN', credentials?.username || 'unknown', { error: 'Missing credentials' })
          return null
        }

        const user = await prisma.user.findUnique({
          where: {
            name: credentials.username
          }
        })

        if (!user || !user.password) {
          logAuthAction('LOGIN', credentials.username, { error: 'User not found' })
          return null
        }

        // 验证密码
        const isPasswordValid = await bcrypt.compare(credentials.password, user.password)

        if (!isPasswordValid) {
          logAuthAction('LOGIN', credentials.username, { error: 'Invalid password' })
          return null
        }

        logAuthAction('LOGIN', user.name, { userId: user.id, success: true })

        return {
          id: user.id,
          name: user.name,
        }
      }
    }),
    // Hanggent SSO: accepts a Hanggent HS256 JWT and auto-creates/finds waoowaoo user
    CredentialsProvider({
      id: "hanggent",
      name: "hanggent",
      credentials: {
        token: { type: "text" },
        email: { type: "text" },
        username: { type: "text" },
      },
      async authorize(credentials) {
        const hanggentSecret = process.env.HANGGENT_JWT_SECRET
        if (!hanggentSecret || !credentials?.token) {
          logAuthAction('HANGGENT_LOGIN', 'unknown', { error: 'Not configured or missing token' })
          return null
        }

        // Verify the Hanggent HS256 JWT
        let payload: jose.JWTPayload
        try {
          const secret = new TextEncoder().encode(hanggentSecret)
          const result = await jose.jwtVerify(credentials.token, secret, { algorithms: ['HS256'] })
          payload = result.payload
        } catch {
          logAuthAction('HANGGENT_LOGIN', credentials.email || 'unknown', { error: 'Invalid token' })
          return null
        }

        const hanggentUserId = payload.id as number | undefined
        if (!hanggentUserId) return null

        // Find or create user
        let user = credentials.email
          ? await prisma.user.findFirst({ where: { email: credentials.email } })
          : null

        if (!user) {
          const hanggentName = `hanggent_${hanggentUserId}`
          user = await prisma.user.findUnique({ where: { name: hanggentName } })
        }

        if (!user) {
          user = await prisma.$transaction(async (tx) => {
            const newUser = await tx.user.create({
              data: {
                name: `hanggent_${hanggentUserId}`,
                email: credentials.email || null,
                password: null,
              },
            })
            await tx.userBalance.create({
              data: { userId: newUser.id, balance: 0, frozenAmount: 0, totalSpent: 0 },
            })
            return newUser
          })
        } else if (credentials.email && !user.email) {
          await prisma.user.update({
            where: { id: user.id },
            data: { email: credentials.email },
          })
        }

        logAuthAction('HANGGENT_LOGIN', user.name, {
          userId: user.id,
          hanggentUserId,
          success: true,
        })

        return { id: user.id, name: user.name }
      }
    }),
  ],
  session: {
    strategy: "jwt"
  },
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async session({ session, token }: any) {
      if (token && session.user) {
        session.user.id = token.id as string
      }
      return session
    }
  }
}
