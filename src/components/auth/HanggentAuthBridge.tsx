'use client'

import { useEffect, useRef } from 'react'
import { signIn, useSession } from 'next-auth/react'

/**
 * Listens for postMessage from the parent hanggent window.
 *
 * Flow:
 *  1. `hanggent-auth` → authenticate via NextAuth "hanggent" provider
 *  2. sends `hanggent-auth-ok` back to parent
 *  3. parent fetches providers and sends `hanggent-sync-providers`
 *  4. bridge POSTs to /api/providers/sync → reloads if auth was fresh
 *
 * Only active when running inside an iframe.
 */
export function HanggentAuthBridge() {
  const { status } = useSession()
  const needsReload = useRef(false)

  useEffect(() => {
    // Only activate inside iframe
    if (typeof window === 'undefined' || window.self === window.top) return

    const handleMessage = async (event: MessageEvent) => {
      // Only accept messages from same origin (hanggent parent)
      if (event.origin !== window.location.origin) return

      const data = event.data
      if (!data || typeof data !== 'object') return

      // ── Auth handshake ──────────────────────────────────────────────
      if (data.type === 'hanggent-auth' && data.token) {
        if (status === 'authenticated') {
          // Already logged in — just request provider sync
          window.parent.postMessage({ type: 'hanggent-auth-ok' }, event.origin)
          return
        }

        try {
          const result = await signIn('hanggent', {
            redirect: false,
            token: data.token,
            email: data.email || '',
            username: data.username || '',
          })

          if (result?.ok) {
            needsReload.current = true
            window.parent.postMessage({ type: 'hanggent-auth-ok' }, event.origin)
            // Don't reload yet — wait for provider sync
          } else {
            console.error('[HanggentAuthBridge] signIn failed:', result?.error)
            window.parent.postMessage(
              { type: 'hanggent-auth-error', error: result?.error || 'SignIn failed' },
              event.origin,
            )
          }
        } catch (err) {
          console.error('[HanggentAuthBridge] Error:', err)
          window.parent.postMessage(
            { type: 'hanggent-auth-error', error: String(err) },
            event.origin,
          )
        }
      }

      // ── Provider sync ───────────────────────────────────────────────
      if (data.type === 'hanggent-sync-providers' && Array.isArray(data.providers)) {
        try {
          const resp = await fetch('/api/providers/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              providers: data.providers,
              defaultModel: data.defaultModel,
            }),
          })

          if (resp.ok) {
            window.parent.postMessage({ type: 'hanggent-sync-done' }, event.origin)
          } else {
            console.error('[HanggentAuthBridge] Provider sync failed:', resp.status)
          }
        } catch (err) {
          console.error('[HanggentAuthBridge] Provider sync error:', err)
        }

        // Reload after sync if this was a fresh authentication
        if (needsReload.current) {
          needsReload.current = false
          window.location.reload()
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [status])

  return null
}
