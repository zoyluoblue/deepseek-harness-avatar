/**
 * Wire contract shared by the host and browser halves. Dependency-free on
 * purpose: the client bundle inlines this module, so anything imported here
 * would be inlined with it.
 *
 * @module @zoytown/dsh-avatar/wire
 */

/** Logical RPC channel the host half registers (`POST /avatar/<endpoint>`). */
export const AVATAR_CHANNEL = '/avatar'

/** RPC endpoints carried by {@link AVATAR_CHANNEL}. */
export const AVATAR_ENDPOINTS = ['upload', 'list', 'delete'] as const

/** HTTP prefix the image bytes are served under (`GET /avatar/image/<file>`). */
export const AVATAR_IMAGE_ROUTE = '/avatar/image'

/** Bumped on incompatible payload changes so a stale browser fails loud. */
export const WIRE_VERSION = 1

/** Image formats this plugin accepts (matched by magic bytes, not extension). */
export type AvatarMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** File extension used on disk and in URLs for each accepted media type. */
export const MEDIA_TYPE_EXTENSIONS: Record<AvatarMediaType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * Stable image identity: `<sha256-hex>.<ext>`. It is simultaneously the disk
 * file name, the URL path segment, and the persisted selection value — one
 * spelling, three uses, so a selection can build its URL with no lookup.
 */
export const AVATAR_FILE_PATTERN = /^[0-9a-f]{64}\.(png|jpg|webp|gif)$/

/** One stored wallpaper. */
export interface AvatarImage {
  /** `<sha256-hex>.<ext>` — see {@link AVATAR_FILE_PATTERN}. */
  file: string
  mediaType: AvatarMediaType
  /** Stored size in bytes. */
  bytes: number
  /** Upload time (file mtime), for newest-first gallery ordering. */
  mtimeMs: number
}

/** `upload` request: one image as canonical base64. */
export interface AvatarUploadRequest {
  /** Base64 of the image bytes (canonical, no whitespace). */
  data: string
  /** Declared type; the host re-sniffs the bytes and rejects mismatches. */
  mediaType: AvatarMediaType
}

/**
 * Business refusals the gallery renders as copy. Transport and shape errors
 * use the RPC error branch instead; these are valid requests the store said
 * no to.
 */
export type AvatarUploadErrorCode = 'empty' | 'too-large' | 'unsupported-type' | 'type-mismatch'

/** `upload` response. Exactly one of `image` / `error` is present. */
export interface AvatarUploadResponse {
  v: typeof WIRE_VERSION
  image?: AvatarImage
  error?: {
    code: AvatarUploadErrorCode
    message: string
    /** Present on `too-large`, so the copy can name the configured cap. */
    maxImageBytes?: number
  }
}

/** `list` response. */
export interface AvatarListResponse {
  v: typeof WIRE_VERSION
  /** Newest first. */
  images: AvatarImage[]
  /** The host's configured per-image cap, for client-side pre-checks. */
  maxImageBytes: number
}

/** `delete` request. */
export interface AvatarDeleteRequest {
  /** `<sha256-hex>.<ext>` of the image to remove. */
  file: string
}

/** `delete` response. `removed` is false when the file was already gone. */
export interface AvatarDeleteResponse {
  v: typeof WIRE_VERSION
  removed: boolean
}

/**
 * Contract bounds for the readability controls — one spelling shared by the
 * settings schema, the controller clamps, the token builder, and the sliders.
 */
export const MASK_OPACITY_MAX = 0.98
export const BLUR_MAX_PX = 60

/**
 * Magic-byte sniff for the four accepted formats. Lives in the wire module so
 * the host store (authoritative acceptance) and the browser uploader (deciding
 * the declared type for files the OS reports without one) share one detector.
 */
export function sniffMediaType(data: Uint8Array): AvatarMediaType | undefined {
  if (data.length >= 8
    && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) {
    return 'image/png'
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg'
  }
  if (data.length >= 6
    && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38
    && (data[4] === 0x37 || data[4] === 0x39) && data[5] === 0x61) {
    return 'image/gif'
  }
  if (data.length >= 12
    && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
    && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
    return 'image/webp'
  }
  return undefined
}

/** Durable user preferences, stored in the `avatar` settings namespace. */
export interface AvatarSettings {
  /** `<sha256-hex>.<ext>` of the active wallpaper, or `''` for none. */
  selected: string
  /**
   * Opacity of the surface veil painted over the wallpaper (the overridden
   * `--dsw-alias-bg-base` / `--dsw-specific-sidebar-fill` alpha). Higher is
   * more readable, lower shows more image.
   */
  maskOpacity: number
  /** Wallpaper blur radius in px. */
  blur: number
  /** How the wallpaper fills the viewport. */
  fill: 'cover' | 'contain' | 'tile'
}

/** Settings namespace registered on the host and bound in the browser. */
export const AVATAR_SETTINGS_NAMESPACE = 'avatar'

/** Defaults mirrored by the host settings schema (single source: this table). */
export const AVATAR_SETTINGS_DEFAULTS: AvatarSettings = {
  selected: '',
  maskOpacity: 0.8,
  blur: 0,
  fill: 'cover',
}

/** Media type for one stored file name, derived from its extension. */
export function mediaTypeOfFile(file: string): AvatarMediaType | undefined {
  const match = AVATAR_FILE_PATTERN.exec(file)
  switch (match?.[1]) {
    case 'png': return 'image/png'
    case 'jpg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    default: return undefined
  }
}
