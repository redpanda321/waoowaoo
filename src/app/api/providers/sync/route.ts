import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { encryptApiKey } from '@/lib/crypto-utils'

interface SyncProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: string[]
}

interface SyncPayload {
  providers: SyncProvider[]
  defaultModel?: string
}

const HANGGENT_PREFIX = 'hanggent-'

/**
 * POST /api/providers/sync
 *
 * Receives provider/model list from hanggent and merges into
 * the user's customProviders & customModels (UserPreference).
 *
 * Hanggent-sourced providers are keyed with "hanggent-" prefix.
 * User's own providers are preserved.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = (await request.json()) as SyncPayload
  const incomingProviders = body.providers || []

  // Read existing config
  const pref = await prisma.userPreference.findUnique({
    where: { userId: session.user.id },
    select: { customProviders: true, customModels: true },
  })

  // Parse existing providers (preserve non-hanggent ones)
  let existingProviders: Array<Record<string, unknown>> = []
  try {
    existingProviders = pref?.customProviders ? JSON.parse(pref.customProviders) : []
  } catch { /* empty */ }

  let existingModels: Array<Record<string, unknown>> = []
  try {
    existingModels = pref?.customModels ? JSON.parse(pref.customModels) : []
  } catch { /* empty */ }

  // Filter out old hanggent providers/models
  const userProviders = existingProviders.filter(
    (p) => typeof p.id === 'string' && !p.id.startsWith(HANGGENT_PREFIX),
  )
  const userModels = existingModels.filter(
    (m) => typeof m.provider === 'string' && !m.provider.startsWith(HANGGENT_PREFIX),
  )

  // Map hanggent providers to waoowaoo format
  const newProviders = incomingProviders.map((p) => ({
    id: p.id.startsWith(HANGGENT_PREFIX) ? p.id : `${HANGGENT_PREFIX}${p.id}`,
    name: p.name,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey ? encryptApiKey(p.apiKey) : '',
  }))

  const newModels = incomingProviders.flatMap((p) => {
    const providerId = p.id.startsWith(HANGGENT_PREFIX) ? p.id : `${HANGGENT_PREFIX}${p.id}`
    return p.models.map((modelId) => ({
      provider: providerId,
      modelId,
      modelKey: `${providerId}::${modelId}`,
      name: modelId,
      type: 'llm' as const,
      price: 0,
    }))
  })

  // Merge: user providers first, then hanggent
  const mergedProviders = [...userProviders, ...newProviders]
  const mergedModels = [...userModels, ...newModels]

  // Upsert into UserPreference
  await prisma.userPreference.upsert({
    where: { userId: session.user.id },
    update: {
      customProviders: JSON.stringify(mergedProviders),
      customModels: JSON.stringify(mergedModels),
    },
    create: {
      userId: session.user.id,
      customProviders: JSON.stringify(mergedProviders),
      customModels: JSON.stringify(mergedModels),
    },
  })

  return NextResponse.json({
    success: true,
    providersCount: newProviders.length,
    modelsCount: newModels.length,
  })
})
