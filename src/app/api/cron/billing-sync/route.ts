import { NextRequest, NextResponse } from 'next/server'
import { syncUsageToHanggent } from '@/lib/billing/hanggent-sync'

/**
 * POST /api/cron/billing-sync
 *
 * Cron-triggered endpoint that syncs unsynced waoowaoo usage records
 * to hanggent for unified billing reporting.
 *
 * Auth: Bearer token must match CRON_SECRET env var.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await syncUsageToHanggent()
  return NextResponse.json({ success: true, ...result })
}
