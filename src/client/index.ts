/**
 * `@zoytown/dsh-avatar` — browser half.
 *
 * Contributes one top-level nav entry to the Settings dialog (the
 * `settings.section` slot; deliberately NOT a tab under Settings → Plugins)
 * and applies the active wallpaper:
 *
 * - the image itself is drawn by the `body::before` layer from the imported
 *   stylesheet, fed through `--dsh-avatar-*` custom properties;
 * - the surface fills that would hide it become a translucent veil through
 *   ONE `ctx.theme.overrideTokens` layer (same-source calls replace the layer
 *   atomically, so slider drags are live and cheap).
 *
 * There is no slot below the app's content, so the body pseudo-element is a
 * deliberate, documented deviation from the slot topology — managed here in
 * the `apply` world via the stylesheet import + theme tokens, fully reverted
 * by the loader (style tag) and the override disposer on unload. Components
 * never see `ctx`.
 *
 * `ctx.slots.inject` waits for the declaration and is a silent no-op when the
 * settings shell is not part of the composition — the wallpaper still
 * applies; only its controls are absent.
 *
 * @module @zoytown/dsh-avatar/client
 */

import { AVATAR_CHANNEL, AVATAR_SETTINGS_NAMESPACE, type AvatarSettings } from '../wire.ts'
import { AvatarSection } from './AvatarSection.tsx'
import { buildOverrideTokens, OVERRIDE_SOURCE } from './background.ts'
import { AvatarController } from './controller.ts'
import { dictionaries, NS } from './locales.ts'
import type { ClientContextLike } from './runtime.d.ts'
// Side-effect import: installs the (inert-by-default) wallpaper layer styles.
import './background-layer.module.css'

/** The slot this plugin registers into. */
const SLOT = 'settings.section'

/** Sorts after the shipped rows (general 0, models 10, plugins 15, agent-presets 20) and the siblings billing (50) / token (60). */
const ORDER = 70

/**
 * Browser-side services this plugin needs. `connection`/`remote` also feed
 * `settingsScope.bind`'s internal subscriptions; `theme` carries the veil.
 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope', 'theme']

export { NS }

/**
 * Register the Background settings page and the wallpaper applier.
 * @param ctx - the browser context.
 */
export function apply(ctx: ClientContextLike): void {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dshAvatar.dictionaries')
  const t = ctx.locale.bind(NS)

  const scope = ctx.settingsScope.bind<AvatarSettings>({ namespace: AVATAR_SETTINGS_NAMESPACE })
  const controller = new AvatarController({
    rpc: (endpoint, payload) => ctx.connection.rpc.call(AVATAR_CHANNEL, endpoint, payload),
    scope,
  })
  ctx.effect(() => () => { controller.dispose() }, 'dshAvatar.controller')

  // Wallpaper applier: one theme override layer follows the controller view.
  ctx.effect(() => {
    let disposeLayer: (() => void) | undefined
    let appliedKey: string | undefined
    const sync = (): void => {
      const spec = controller.backgroundSpec()
      const key = spec === null ? undefined : JSON.stringify(spec)
      if (key === appliedKey) return
      appliedKey = key
      if (spec === null) {
        disposeLayer?.()
        disposeLayer = undefined
        return
      }
      // Same source replaces the whole layer; the previous disposer becomes a
      // no-op, so only the newest one is worth holding.
      disposeLayer = ctx.theme.overrideTokens(OVERRIDE_SOURCE, buildOverrideTokens(spec))
    }
    const unsubscribe = controller.subscribe(sync)
    // The gallery list also feeds the dangling-selection guard, so warm it now
    // rather than on first settings-page visit.
    controller.ensure()
    sync()
    return () => {
      unsubscribe()
      disposeLayer?.()
    }
  }, 'dshAvatar.background')

  ctx.slots.inject(SLOT, () => ctx.slots.register({
    name: SLOT,
    id: 'avatar',
    order: ORDER,
    // A thunk, not a string: the label is re-read per projection, so a
    // language switch relabels the row without re-registering it.
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ controller }),
  }, AvatarSection))
}
