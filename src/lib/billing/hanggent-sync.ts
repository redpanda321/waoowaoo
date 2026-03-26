/**
 * Sync waoowaoo usage records to hanggent for unified reporting.
 *
 * Flow:
 *   1. Query unsynced UsageCost rows whose user is hanggent-linked (name starts with "hanggent_")
 *   2. Map each to hanggent format and POST in batches
 *   3. Mark synced rows via syncedToHanggent = true
 *
 * Called periodically (e.g. cron) or after task completion.
 */

import { prisma } from '@/lib/prisma'
import { logWarn, logError, logInfo } from '@/lib/logging/core'

const HANGGENT_SERVER_URL = process.env.HANGGENT_SERVER_URL || ''
const WAOOWAOO_SYNC_TOKEN = process.env.WAOOWAOO_SYNC_TOKEN || ''
const BATCH_SIZE = 100

interface HanggentUsageRecord {
  hanggent_user_id: number
  project_id: string
  api_type: string
  model: string
  action: string
  quantity: number
  unit: string
  cost: number
  waoowaoo_record_id: string
  timestamp: string
}

/**
 * Extract hanggent user ID from the waoowaoo user name.
 * The auth bridge creates users with name "hanggent_<id>".
 * Returns null if the user is not hanggent-linked.
 */
function extractHanggentUserId(userName: string): number | null {
  const match = userName.match(/^hanggent_(\d+)$/)
  return match ? parseInt(match[1], 10) : null
}

/**
 * Sync all unsynced usage records for hanggent-linked users.
 * Returns the count of records synced.
 */
export async function syncUsageToHanggent(): Promise<{ synced: number; failed: number }> {
  if (!HANGGENT_SERVER_URL || !WAOOWAOO_SYNC_TOKEN) {
    logWarn('Hanggent sync not configured (missing HANGGENT_SERVER_URL or WAOOWAOO_SYNC_TOKEN)')
    return { synced: 0, failed: 0 }
  }

  // Find unsynced records for hanggent-linked users
  const unsyncedRecords = await prisma.usageCost.findMany({
    where: {
      syncedToHanggent: false,
      user: {
        name: { startsWith: 'hanggent_' },
      },
    },
    include: { user: { select: { name: true } } },
    take: BATCH_SIZE,
    orderBy: { createdAt: 'asc' },
  })

  if (unsyncedRecords.length === 0) {
    return { synced: 0, failed: 0 }
  }

  // Map to hanggent format
  const records: HanggentUsageRecord[] = []
  const validIds: string[] = []

  for (const rec of unsyncedRecords) {
    const hanggentUserId = extractHanggentUserId(rec.user.name)
    if (hanggentUserId === null) continue

    records.push({
      hanggent_user_id: hanggentUserId,
      project_id: rec.projectId,
      api_type: rec.apiType,
      model: rec.model,
      action: rec.action,
      quantity: rec.quantity,
      unit: rec.unit,
      cost: Number(rec.cost),
      waoowaoo_record_id: rec.id,
      timestamp: rec.createdAt.toISOString(),
    })
    validIds.push(rec.id)
  }

  if (records.length === 0) {
    return { synced: 0, failed: 0 }
  }

  // POST to hanggent
  try {
    const url = `${HANGGENT_SERVER_URL.replace(/\/$/, '')}/api/waoowaoo/usage-sync`
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WAOOWAOO_SYNC_TOKEN}`,
      },
      body: JSON.stringify({ records }),
    })

    if (!resp.ok) {
      logError(`Usage sync failed: HTTP ${resp.status}`)
      return { synced: 0, failed: records.length }
    }

    // Mark all posted records as synced
    await prisma.usageCost.updateMany({
      where: { id: { in: validIds } },
      data: { syncedToHanggent: true },
    })

    const result = await resp.json()
    logInfo(`Usage sync complete: ${result.synced} created, ${result.skipped} skipped`)
    return { synced: validIds.length, failed: 0 }
  } catch (err) {
    logError('Usage sync error:', err)
    return { synced: 0, failed: records.length }
  }
}
