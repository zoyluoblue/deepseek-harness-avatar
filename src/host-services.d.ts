/**
 * Minimal local declarations for the host-side Connection RPC surface.
 *
 * WHY THESE ARE LOCAL: the authoritative types live in
 * `@deepseek-ai/dsh-client-connection` (Context merge) and
 * `@deepseek-ai/dsh-host-apiproxy/api` (RpcResult), but installing either
 * from npm drags in most of the harness dependency graph and currently
 * crashes npm's resolver on a broken transitive peer set. That blocks type
 * checking only, never the build: both packages are `external` in the host
 * bundle and resolve at runtime through the profile's own installation.
 *
 * Each shape mirrors upstream and cites its source. Keep them narrow — a
 * smaller surface is a smaller lie.
 *
 * @module @zoytown/dsh-avatar/host-services
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
// Load-bearing: without importing the target module first, `declare module`
// below would be an ambient module DECLARATION that replaces the package's
// entire type surface instead of augmenting it (ctx.effect/ctx.inject vanish).
import type { Context } from '@deepseek-ai/cordis'

/**
 * Business error of one RPC call (apiproxy `src/api/rpc.ts:105-107`).
 * Upstream `code` is a closed union; this plugin only ever produces
 * `bad-request` (details `{ issues: [] }`) and `internal` (details `{}`).
 */
export interface RpcErrorShape {
  code: string
  message: string
  details: unknown
}

/** Business success/failure result (apiproxy `src/api/rpc.ts:112`). */
export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: RpcErrorShape }

/** Handler invoked after Connection has decoded the transport envelope (connection `src/rpc.ts:16-20`). */
export type ConnectionRpcHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<RpcResult<unknown>>

/** Host registry for logical RPC channels (connection `src/rpc.ts:26-53`). */
export interface HostConnectionRpc {
  handle(
    channel: string,
    handler: ConnectionRpcHandler,
    options: { authority: 'trusted-host' | 'loopback' },
  ): () => Promise<void>
}

/** Host `ctx.connection` shape (connection `src/rpc.ts:56-59`, merge `src/rpc-host.ts:36-41`). */
export interface HostConnectionHandle {
  readonly rpc: HostConnectionRpc
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Connection transport and RPC registrations (provided by `@deepseek-ai/dsh-client-connection`). */
    connection: HostConnectionHandle
  }
}

/** Re-exported so route modules can type handlers without importing http twice. */
export type WebHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
