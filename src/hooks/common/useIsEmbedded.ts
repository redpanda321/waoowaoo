'use client'

import { useState, useEffect } from 'react'

/**
 * Returns `true` when the app is running inside an iframe (embedded in hanggent).
 * Uses the same detection as HanggentAuthBridge: `window.self !== window.top`.
 */
export function useIsEmbedded(): boolean {
  const [embedded, setEmbedded] = useState(false)

  useEffect(() => {
    try {
      setEmbedded(window.self !== window.top)
    } catch {
      // Cross-origin iframe access throws — treat as embedded
      setEmbedded(true)
    }
  }, [])

  return embedded
}
