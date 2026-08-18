/**
 * Token layer for the active wallpaper — the pure half of the background
 * mechanism (the impure half, one `overrideTokens` call, lives in index.ts).
 *
 * Two things happen at once and both are required:
 *
 * 1. The wallpaper itself is drawn by `body::before` (background-layer
 *    stylesheet), fed through the `--dsh-avatar-*` custom properties below.
 *    There is deliberately no image value inside any `--dsw-*` token: those
 *    are consumed by 22+ `var()` sites as colors, and an image value breaks
 *    gradients, `color-mix()`, and `background-color` longhands outright.
 *
 * 2. The opaque surface fills that would hide the wallpaper — `.frame`,
 *    the conversation column, the sidebar — are turned into a translucent
 *    veil by overriding `--dsw-alias-bg-base` and
 *    `--dsw-specific-sidebar-fill` with alpha COLORS. `color-mix()` over the
 *    upstream static scale keeps the veil palette-true in both schemes
 *    without hardcoding any literal color.
 *
 * @module @zoytown/dsh-avatar/client/background
 */

import { AVATAR_IMAGE_ROUTE, BLUR_MAX_PX, MASK_OPACITY_MAX, type AvatarSettings } from '../wire.ts'
import type { ThemeTokenModes } from './runtime.d.ts'

/** Override-layer identity passed to `ctx.theme.overrideTokens`. */
export const OVERRIDE_SOURCE = 'dsh-avatar'

/** What the token layer needs to know; `file` is already validated. */
export interface BackgroundSpec {
  file: string
  maskOpacity: number
  blur: number
  fill: AvatarSettings['fill']
}

/** Same value in both schemes (scheme-invariant tokens repeat it by contract). */
function both(value: string): ThemeTokenModes {
  return { light: value, dark: value }
}

/** Veil color: the scheme's own base surface color at the requested opacity. */
function veil(staticToken: string, percent: number): string {
  return `color-mix(in srgb, var(${staticToken}) ${percent}%, transparent)`
}

/**
 * Build the full override layer for one wallpaper spec.
 *
 * `maskOpacity` is the EFFECTIVE veil the user sees, not the raw token alpha:
 * the app paints the same token more than once per region (`.frame` and the
 * conversation/details column each fill with bg-base; the sidebar stacks one
 * bg-base fill under two sidebar-fill fills), and translucent layers compose
 * as 1-(1-α)^n. The per-token alphas below invert that — bg-base for its two
 * coats, sidebar-fill for its two coats over one compensated bg-base coat —
 * so a 40% slider is a 40% veil everywhere instead of 64–78% depending on
 * which column you look at.
 *
 * @param spec - active wallpaper and its readability controls.
 * @returns tokens for `ctx.theme.overrideTokens(OVERRIDE_SOURCE, ...)`.
 */
export function buildOverrideTokens(spec: BackgroundSpec): Record<string, ThemeTokenModes> {
  const effective = Math.min(Math.max(spec.maskOpacity, 0), MASK_OPACITY_MAX)
  // Two bg-base coats: (1-α)² = 1-s. Sidebar: (1-α_bg)·(1-α_sf)² = 1-s.
  const bgPercent = Math.round((1 - Math.sqrt(1 - effective)) * 100)
  const sidebarPercent = Math.round((1 - (1 - effective) ** 0.25) * 100)
  const blur = Math.min(Math.max(spec.blur, 0), BLUR_MAX_PX)
  return {
    // Upstream light values: bg-base = neutral-bluish-00, sidebar = -50;
    // dark: bg-base = -950, sidebar = -900 (design-platform.css:157,241,249,333).
    '--dsw-alias-bg-base': {
      light: veil('--dsw-static-neutral-bluish-00', bgPercent),
      dark: veil('--dsw-static-neutral-bluish-950', bgPercent),
    },
    '--dsw-specific-sidebar-fill': {
      light: veil('--dsw-static-neutral-bluish-50', sidebarPercent),
      dark: veil('--dsw-static-neutral-bluish-900', sidebarPercent),
    },
    '--dsh-avatar-image': both(`url("${AVATAR_IMAGE_ROUTE}/${spec.file}")`),
    '--dsh-avatar-blur': both(`${blur}px`),
    '--dsh-avatar-size': both(spec.fill === 'tile' ? 'auto' : spec.fill),
    '--dsh-avatar-repeat': both(spec.fill === 'tile' ? 'repeat' : 'no-repeat'),
    // Letterbox / underdraw ground behind the image, in the scheme's own base.
    '--dsh-avatar-canvas': {
      light: 'var(--dsw-static-neutral-bluish-00)',
      dark: 'var(--dsw-static-neutral-bluish-950)',
    },
  }
}
