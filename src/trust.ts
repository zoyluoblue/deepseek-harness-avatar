/**
 * Browser-trust fence for this package's image route.
 *
 * A local HTTP server opens two confused-deputy paths that network placement
 * alone does not close: **DNS rebinding**, where a malicious page resolves its
 * own domain to 127.0.0.1 so the socket reaches this server while `Host` names
 * the attacker, and ordinary **cross-site reads** fired from any page the user
 * has open. Wallpapers are low-value data, but the fence is cheap and keeps
 * the route from becoming a loopback probe.
 *
 * The harness applies an equivalent fence to `/api`, but its implementation is
 * not reachable through the published `exports` map, so this is a deliberate,
 * self-contained reimplementation of the same idea (shared verbatim with the
 * sibling `@zoytown/dsh-billing` plugin — copied, not imported, per the
 * workspace's no-cross-repo-imports rule). It is strictly more conservative:
 * no LAN-IP grants are derived, so anything beyond loopback must be named
 * explicitly in `trustedHosts`.
 *
 * This is not authentication. It stops a browser from being used as a proxy
 * into the loopback interface; it does not identify callers.
 *
 * @module @zoytown/dsh-avatar/trust
 */

import type { IncomingMessage } from 'node:http'

/** Read one header as a single string, collapsing the array form. */
function headerOf(request: IncomingMessage, name: string): string | undefined {
  const raw = request.headers[name]
  if (raw === undefined) return undefined
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === undefined || value.length === 0 ? undefined : value
}

/**
 * Whether an authority names this machine's loopback interface.
 *
 * Parsed through WHATWG rather than string-matched so that alternate
 * spellings (`0x7f.0.0.1`, `127.1`, `[::1]`) normalize before comparison
 * instead of slipping past a naive prefix check.
 *
 * @param authority - the raw `Host` header value.
 * @returns true when the authority is loopback.
 */
export function isLoopbackAuthority(authority: string): boolean {
  let url: URL
  try {
    url = new URL(`http://${authority}`)
  } catch {
    return false
  }
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host === '[::1]' || host === '::1') return true
  // 127.0.0.0/8 — WHATWG has already canonicalized shorthand forms.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

/**
 * Fail-loud validation for the `trustedHosts` config, run at plugin load.
 *
 * An entry that can never match a `Host` header (scheme, path, userinfo,
 * whitespace, or unparsable authority) would otherwise deny silently at
 * request time — the config looks applied while every remote fetch 403s.
 * Mirrors the harness's own load-time `assertTrustedAuthority` posture.
 *
 * @param entries - configured authorities, `host` or `host:port`.
 * @throws Error naming the first malformed entry.
 */
export function assertTrustedHosts(entries: readonly string[]): void {
  for (const entry of entries) {
    let url: URL | undefined
    try {
      url = new URL(`http://${entry}`)
    } catch {
      url = undefined
    }
    const wellFormed = url !== undefined
      && entry.length > 0
      && !/[\s/@#?]/.test(entry)
      && url.pathname === '/'
      && url.username === '' && url.password === ''
    if (!wellFormed) {
      throw new Error(
        `dsh-avatar: trustedHosts entry ${JSON.stringify(entry)} is not a plain "host" or "host:port" authority `
        + '— it could never match a Host header and would deny silently',
      )
    }
  }
}

/**
 * Decide whether one request may read a wallpaper.
 *
 * Two independent gates, both must pass:
 *
 * 1. **Host** must be loopback or an explicitly configured authority. `Host`
 *    is the one header DNS rebinding cannot forge into ours.
 * 2. **Fetch metadata**, when the browser attached any, must say the request
 *    came from this origin. Absence is not treated as failure: plain-HTTP
 *    reads carry no such headers, and gate 1 already binds them.
 *
 * @param request - the incoming request.
 * @param trustedHosts - non-loopback authorities this deployment serves,
 *   lowercase `host` or `host:port`.
 * @returns true when the request may be answered.
 */
export function isTrustedRequest(
  request: IncomingMessage,
  trustedHosts: readonly string[],
): boolean {
  const site = headerOf(request, 'sec-fetch-site')
  // `none` is a user-initiated navigation; `same-origin` is our own page.
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false

  const host = headerOf(request, 'host')
  if (host === undefined) return false
  if (isLoopbackAuthority(host)) return true

  const normalized = host.toLowerCase()
  return trustedHosts.some((entry) => {
    const trusted = entry.toLowerCase()
    if (trusted === normalized) return true
    // A port-less entry grants every port on that host, matching the harness's
    // own `trustedHosts` semantics.
    return !trusted.includes(':') && normalized.startsWith(`${trusted}:`)
  })
}
