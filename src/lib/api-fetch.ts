const LOCALE_PATH_PATTERN = /^\/(zh|en)(\/|$)/

/** Runtime basePath — empty in dev, '/waoowaoo' in production Docker build. */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || ''

function resolveLocaleFromPath(pathname: string): string {
  const match = pathname.match(LOCALE_PATH_PATTERN)
  return match?.[1] ?? 'zh'
}

export function getPageLocale(): string {
  if (typeof window === 'undefined') return 'zh'
  return resolveLocaleFromPath(window.location.pathname)
}

/** Return the hanggent JWT stored by HanggentAuthBridge (client-side only). */
export function getHanggentToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem('hanggent_token')
  } catch {
    return null
  }
}

function resolveRequestPathname(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    if (input.startsWith('/')) return input
    try {
      return new URL(input).pathname
    } catch {
      return ''
    }
  }

  if (input instanceof URL) {
    return input.pathname
  }

  try {
    return new URL(input.url).pathname
  } catch {
    return ''
  }
}

function shouldInjectLocaleHeader(input: RequestInfo | URL): boolean {
  const pathname = resolveRequestPathname(input)
  return pathname === '/api' || pathname.startsWith('/api/')
}

/** Check if a path is a local API call that needs basePath and auth headers. */
function isLocalApiPath(input: RequestInfo | URL): boolean {
  if (typeof input === 'string') {
    // Absolute URL — not a local relative call
    if (input.startsWith('http://') || input.startsWith('https://')) return false
    return input === '/api' || input.startsWith('/api/')
  }
  if (input instanceof URL) return false
  // Request object with absolute URL
  return false
}

export function mergeLocaleHeader(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  if (!headers.has('Accept-Language')) {
    headers.set('Accept-Language', getPageLocale())
  }
  return { ...init, headers }
}

/**
 * Wrapper around fetch that:
 * 1. Prepends basePath to local /api/* calls (so /api/projects → /waoowaoo/api/projects)
 * 2. Injects Accept-Language header
 * 3. Injects Authorization: Bearer <hanggent_token> when available
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let resolvedInput = input

  // Prepend basePath for local /api/* paths
  if (BASE_PATH && typeof input === 'string' && isLocalApiPath(input)) {
    resolvedInput = `${BASE_PATH}${input}`
  }

  // Build merged init with locale + auth headers
  const merged = shouldInjectLocaleHeader(input)
    ? mergeLocaleHeader(init)
    : (init ?? {})

  // Inject Bearer token if available (client-side only)
  const token = getHanggentToken()
  if (token) {
    const headers = new Headers(merged.headers)
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    return fetch(resolvedInput, { ...merged, headers })
  }

  return fetch(resolvedInput, merged)
}
