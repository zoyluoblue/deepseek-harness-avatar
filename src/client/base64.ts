/**
 * Canonical base64 for upload payloads. Chunked so a 20MB wallpaper does not
 * blow the argument-count limit of `String.fromCharCode(...bytes)` (mirrors
 * upstream ui-conversation `service.ts`).
 *
 * @module @zoytown/dsh-avatar/client/base64
 */

/** Encode bytes as canonical base64. */
export function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < data.length; index += chunk) {
    binary += String.fromCharCode(...data.subarray(index, index + chunk))
  }
  return btoa(binary)
}
