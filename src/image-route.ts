/**
 * `GET /avatar/image/<file>` — wallpaper bytes for `<img>` tags and the
 * background layer's `url()`.
 *
 * A plain webserver route rather than an RPC endpoint because the consumer is
 * the browser's resource loader, which speaks GET + bytes, not POST + JSON.
 * The file segment is matched against the content-addressed pattern before it
 * goes anywhere near a path join, so traversal never has input to work with.
 *
 * NOTE: this module must not be named `client` — `lib/client.js` is the
 * browser bundle's reserved output name and a host module compiled there
 * would be silently overwritten.
 *
 * @module @zoytown/dsh-avatar/image-route
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AvatarStore } from './store.ts'
import { isTrustedRequest } from './trust.ts'
import { AVATAR_IMAGE_ROUTE } from './wire.ts'

/**
 * Build the prefix-route handler over one store.
 * @param store - the wallpaper store.
 * @param trustedHosts - non-loopback authorities allowed to read images.
 * @returns handler for `ctx.webServer.register({ kind: 'prefix', path: AVATAR_IMAGE_ROUTE })`.
 */
export function createImageRouteHandler(
  store: AvatarStore,
  trustedHosts: readonly string[],
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' })
      response.end()
      return
    }
    if (!isTrustedRequest(request, trustedHosts)) {
      // Deliberately terse: a rebinding probe learns nothing from a 403.
      response.writeHead(403)
      response.end('forbidden')
      return
    }

    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    const file = pathname.startsWith(`${AVATAR_IMAGE_ROUTE}/`)
      ? pathname.slice(AVATAR_IMAGE_ROUTE.length + 1)
      : undefined
    const stored = file === undefined ? undefined : await store.read(file)
    if (stored === undefined) {
      response.writeHead(404)
      response.end('not found')
      return
    }

    response.writeHead(200, {
      'content-type': stored.mediaType,
      'content-length': stored.data.length,
      // Content-addressed name: the bytes behind one URL can never change.
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    })
    response.end(request.method === 'HEAD' ? undefined : stored.data)
  }
}
