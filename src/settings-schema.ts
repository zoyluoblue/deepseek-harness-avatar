/**
 * Schema for the durable `avatar` settings namespace. Separate from wire.ts
 * so the wire module stays dependency-free (the client bundle inlines it).
 *
 * `@deepseek-ai/schemastery` is this repo's single validator source (§8.2):
 * it is what `ctx.settings.register` is typed against, and being the
 * harness's vendored rescope it needs no cast at that boundary.
 *
 * @module @zoytown/dsh-avatar/settings-schema
 */

import z from '@deepseek-ai/schemastery'
import { AVATAR_SETTINGS_DEFAULTS, BLUR_MAX_PX, MASK_OPACITY_MAX, type AvatarSettings } from './wire.ts'

/**
 * Bounds are UI contract, not taste: maskOpacity is capped below 1 so the
 * wallpaper can never be fully painted over (a 100% veil is "no background",
 * which is `selected: ''`), and blur is capped where larger radii only cost
 * compositor time without changing the look. Both bounds live in wire.ts so
 * the sliders, the controller clamps, and this schema cannot drift apart.
 */
export const AvatarSettingsSchema: z<AvatarSettings> = z.object({
  selected: z.string().default(AVATAR_SETTINGS_DEFAULTS.selected),
  maskOpacity: z.number().min(0).max(MASK_OPACITY_MAX).default(AVATAR_SETTINGS_DEFAULTS.maskOpacity),
  blur: z.number().min(0).max(BLUR_MAX_PX).default(AVATAR_SETTINGS_DEFAULTS.blur),
  fill: z.union(['cover', 'contain', 'tile']).default(AVATAR_SETTINGS_DEFAULTS.fill),
})
