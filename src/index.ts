/**
 * `@zoytown/dsh-avatar` — host half.
 *
 * Owns the wallpaper file store under `$DSH_HOME/avatar/v1`, the `/avatar`
 * upload/list/delete RPC channel, the `GET /avatar/image/<file>` byte route,
 * and the durable `avatar` settings namespace the browser half binds.
 *
 * Every external service is OPTIONAL, mounted through child fibers rather
 * than `inject`. Vendored cordis has no optional-inject syntax and an
 * unavailable peer leaves a plugin pending forever — which, for this plugin,
 * would silently remove the settings page with no error anywhere. A headless
 * composition simply mounts none of the three fibers.
 *
 * @module @zoytown/dsh-avatar
 */

import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
// Type-only: apply the `ctx.webServer` Context merge without a value import;
// the `ctx.connection` merge comes from the local host-services declarations
// (see that file's header for why they are local).
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from './host-services.d.ts'
import z from '@deepseek-ai/schemastery'
import { createImageRouteHandler } from './image-route.ts'
import { createAvatarRpcHandler } from './rpc.ts'
import { assertTrustedHosts } from './trust.ts'
import { AvatarSettingsSchema } from './settings-schema.ts'
import { AvatarStore } from './store.ts'
import { AVATAR_CHANNEL, AVATAR_IMAGE_ROUTE, AVATAR_SETTINGS_NAMESPACE } from './wire.ts'

export const name = 'dsh-avatar'

export * from './wire.ts'
export { AvatarStore, AvatarStoreError, sniffMediaType } from './store.ts'

/** Plugin configuration. */
export interface Config {
  /** Override the dsh home the wallpaper directory lives under (tests, exotic setups). */
  dshHome?: string
  /** Per-image size cap in bytes; larger uploads are refused with `too-large`. */
  maxImageBytes: number
  /**
   * Non-loopback authorities allowed to fetch wallpaper bytes, as `host` or
   * `host:port`. Empty by default: a deployment bound to `0.0.0.0` serves
   * images to loopback only until it names its own authority here. (Uploads
   * and preferences stay loopback-only regardless — the harness pins its
   * settings API to loopback, so a remote browser is read-only anyway.)
   */
  trustedHosts: string[]
}

export const Config: z<Config> = z.object({
  dshHome: z.string(),
  maxImageBytes: z.number().min(1024).default(20 * 1024 * 1024),
  trustedHosts: z.array(String).default([]),
})

/**
 * Mount the store, its transports, and the settings namespace.
 * @param ctx - the plugin context.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  // A trustedHosts entry that can never match fails the load here, not
  // silently at request time (workspace fail-loud rule, upstream posture).
  assertTrustedHosts(config.trustedHosts)
  const root = resolve(join(resolveDshHome(config.dshHome), 'avatar', 'v1'))
  const store = new AvatarStore(root, config.maxImageBytes)

  // Durable preferences: only in compositions that mount a settings provider.
  const settingsFiber = ctx.inject(['settings'], (childCtx: Context) => {
    childCtx.settings.register(settingsNamespace(AVATAR_SETTINGS_NAMESPACE), AvatarSettingsSchema)
  })
  ctx.effect(() => () => { settingsFiber.dispose() }, 'dshAvatar.optionalSettings')

  // Upload/list/delete ride the Connection RPC fence (POST + JSON envelope +
  // browser-trust gate). Loopback authority: writes never cross the machine.
  const rpcFiber = ctx.inject(['connection'], (childCtx: Context) => {
    childCtx.effect(
      () => childCtx.connection.rpc.handle(AVATAR_CHANNEL, createAvatarRpcHandler(store), { authority: 'loopback' }),
      'dshAvatar.rpc',
    )
  })
  ctx.effect(() => () => { rpcFiber.dispose() }, 'dshAvatar.optionalConnection')

  // Image bytes are a plain GET route — the browser's resource loader is the
  // consumer. Longest-prefix matching keeps it out of the RPC channel above.
  const routeFiber = ctx.inject(['webServer'], (childCtx: Context) => {
    childCtx.effect(
      () => childCtx.webServer.register({
        kind: 'prefix',
        path: AVATAR_IMAGE_ROUTE,
        handler: createImageRouteHandler(store, config.trustedHosts),
      }),
      'dshAvatar.imageRoute',
    )
  })
  ctx.effect(() => () => { routeFiber.dispose() }, 'dshAvatar.optionalWebServer')

  ctx.logger?.debug?.('dsh-avatar: wallpaper store at %s', root)
}
