/**
 * The `/avatar` RPC channel: upload / list / delete, carried by
 * `ctx.connection.rpc.handle`, which supplies the browser-trust fence, the
 * POST + JSON envelope, and the transport — this module only validates
 * payloads and talks to the store.
 *
 * Error split: malformed payloads use the RPC error branch (`bad-request`);
 * store refusals (too large, wrong format) are business outcomes and travel
 * inside a successful response, where the gallery turns them into copy.
 *
 * @module @zoytown/dsh-avatar/rpc
 */

import type { RpcResult } from './host-services.d.ts'
import { AvatarStore, AvatarStoreError } from './store.ts'
import {
  WIRE_VERSION,
  type AvatarDeleteResponse,
  type AvatarListResponse,
  type AvatarMediaType,
  type AvatarUploadResponse,
} from './wire.ts'

/** The handler shape `ctx.connection.rpc.handle` expects. */
export type AvatarRpcHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<RpcResult<unknown>>

const MEDIA_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

function badRequest(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }
}

/**
 * Decode canonical base64. Returns undefined for anything the encoder below
 * would not have produced — whitespace, missing padding, or trailing bits —
 * so an accepted payload always round-trips byte-identical.
 */
export function decodeCanonicalBase64(data: string): Buffer | undefined {
  if (data.length === 0 || data.length % 4 !== 0) return undefined
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return undefined
  const bytes = Buffer.from(data, 'base64')
  return bytes.toString('base64') === data ? bytes : undefined
}

/**
 * Build the channel handler over one store.
 * @param store - the wallpaper store.
 * @returns handler for `ctx.connection.rpc.handle(AVATAR_CHANNEL, ...)`.
 */
export function createAvatarRpcHandler(store: AvatarStore): AvatarRpcHandler {
  return async (endpoint, payload) => {
    try {
      switch (endpoint) {
        case 'upload': return await upload(store, payload)
        case 'list': return ok<AvatarListResponse>({
          v: WIRE_VERSION,
          images: await store.list(),
          maxImageBytes: store.maxImageBytes,
        })
        case 'delete': return await remove(store, payload)
        default: return badRequest(`unknown avatar endpoint ${JSON.stringify(endpoint)}`)
      }
    } catch (error: unknown) {
      // Store refusals are handled inside the endpoints; reaching here means
      // an I/O failure (disk full, permissions), which is an internal error.
      return {
        ok: false,
        error: {
          code: 'internal',
          message: error instanceof Error ? error.message : String(error),
          details: {},
        },
      }
    }
  }
}

async function upload(store: AvatarStore, payload: unknown): Promise<RpcResult<AvatarUploadResponse>> {
  if (typeof payload !== 'object' || payload === null) {
    return badRequest('upload payload must be an object')
  }
  const { data, mediaType } = payload as { data?: unknown; mediaType?: unknown }
  if (typeof data !== 'string' || typeof mediaType !== 'string' || !MEDIA_TYPES.includes(mediaType)) {
    return badRequest('upload payload must be { data: base64 string, mediaType: png|jpeg|webp|gif }')
  }
  // Size gate BEFORE any O(n) decode work: base64 length bounds the decoded
  // size, so an over-cap payload is refused from its string length alone and
  // the configured cap also caps this endpoint's memory/CPU per request.
  if (data.length > Math.ceil(store.maxImageBytes / 3) * 4 + 4) {
    return ok<AvatarUploadResponse>({
      v: WIRE_VERSION,
      error: {
        code: 'too-large',
        message: `payload exceeds the configured cap of ${store.maxImageBytes} bytes`,
        maxImageBytes: store.maxImageBytes,
      },
    })
  }
  const bytes = decodeCanonicalBase64(data)
  if (bytes === undefined) {
    return badRequest('upload data is not canonical base64')
  }
  try {
    const image = await store.save(bytes, mediaType as AvatarMediaType)
    return ok<AvatarUploadResponse>({ v: WIRE_VERSION, image })
  } catch (error: unknown) {
    if (error instanceof AvatarStoreError) {
      return ok<AvatarUploadResponse>({
        v: WIRE_VERSION,
        error: {
          code: error.code,
          message: error.message,
          ...(error.code === 'too-large' ? { maxImageBytes: store.maxImageBytes } : {}),
        },
      })
    }
    throw error
  }
}

async function remove(store: AvatarStore, payload: unknown): Promise<RpcResult<AvatarDeleteResponse>> {
  if (typeof payload !== 'object' || payload === null
    || typeof (payload as { file?: unknown }).file !== 'string') {
    return badRequest('delete payload must be { file: string }')
  }
  const removed = await store.remove((payload as { file: string }).file)
  return ok<AvatarDeleteResponse>({ v: WIRE_VERSION, removed })
}
