/**
 * Wallpaper file store: a flat content-addressed directory under the dsh home
 * (`$DSH_HOME/avatar/v1/<sha256>.<ext>`).
 *
 * Content addressing makes writes idempotent — re-uploading an image lands on
 * the same name — so no cross-process lock is needed: the worst concurrent
 * case is two writers publishing identical bytes. Publication is still
 * tmp-file + rename so a crashed upload never leaves a half image behind.
 *
 * Acceptance is decided by magic bytes, never by the declared media type or
 * the file extension: a mislabeled upload is rejected as `type-mismatch`.
 *
 * @module @zoytown/dsh-avatar/store
 */

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AVATAR_FILE_PATTERN,
  MEDIA_TYPE_EXTENSIONS,
  mediaTypeOfFile,
  sniffMediaType,
  type AvatarImage,
  type AvatarMediaType,
  type AvatarUploadErrorCode,
} from './wire.ts'

export { sniffMediaType }

/** A refusal the wire layer maps onto `AvatarUploadResponse.error`. */
export class AvatarStoreError extends Error {
  constructor(
    readonly code: AvatarUploadErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AvatarStoreError'
  }
}

/** One stored file read back for serving. */
export interface StoredAvatarImage {
  data: Buffer
  mediaType: AvatarMediaType
}

/** Flat content-addressed wallpaper directory. */
export class AvatarStore {
  /**
   * @param root - absolute storage directory (created on first write).
   * @param maxImageBytes - per-image size cap; larger uploads are refused.
   */
  constructor(
    private readonly root: string,
    readonly maxImageBytes: number,
  ) {}

  /**
   * Validate and persist one image.
   * @param data - raw image bytes.
   * @param declaredMediaType - the uploader's claim, checked against the sniff.
   * @returns the stored image record (existing record when already present).
   * @throws AvatarStoreError on refusal; anything else is an I/O failure.
   */
  async save(data: Uint8Array, declaredMediaType: AvatarMediaType): Promise<AvatarImage> {
    if (data.length === 0) {
      throw new AvatarStoreError('empty', 'image is empty')
    }
    if (data.length > this.maxImageBytes) {
      throw new AvatarStoreError(
        'too-large',
        `image is ${data.length} bytes; the configured cap is ${this.maxImageBytes}`,
      )
    }
    const sniffed = sniffMediaType(data)
    if (sniffed === undefined) {
      throw new AvatarStoreError('unsupported-type', 'bytes are not png, jpeg, webp, or gif')
    }
    if (sniffed !== declaredMediaType) {
      throw new AvatarStoreError(
        'type-mismatch',
        `declared ${declaredMediaType} but the bytes are ${sniffed}`,
      )
    }

    const hash = createHash('sha256').update(data).digest('hex')
    const file = `${hash}.${MEDIA_TYPE_EXTENSIONS[sniffed]}`
    const target = join(this.root, file)

    const existing = await statOrUndefined(target)
    if (existing === undefined) {
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      // Same-directory rename is atomic publication; the suffix only needs to
      // dodge a concurrent writer of the same content, not be unguessable.
      const temp = join(this.root, `.tmp-${randomBytes(8).toString('hex')}`)
      try {
        await writeFile(temp, data, { mode: 0o600, flush: true })
        await rename(temp, target)
      } finally {
        // A successful rename already consumed the temp name, so this only
        // sweeps the failure path; a second failure here has nothing to add.
        await rm(temp, { force: true }).catch(() => undefined)
      }
    }

    const published = await stat(target)
    return { file, mediaType: sniffed, bytes: published.size, mtimeMs: published.mtimeMs }
  }

  /** All stored images, newest first. A missing directory is an empty gallery. */
  async list(): Promise<AvatarImage[]> {
    let names: string[]
    try {
      names = await readdir(this.root)
    } catch (error: unknown) {
      if (isErrnoCode(error, 'ENOENT')) return []
      throw error
    }
    const images: AvatarImage[] = []
    for (const name of names) {
      const mediaType = mediaTypeOfFile(name)
      if (mediaType === undefined) continue
      const info = await statOrUndefined(join(this.root, name))
      if (info === undefined) continue
      images.push({ file: name, mediaType, bytes: info.size, mtimeMs: info.mtimeMs })
    }
    images.sort((left, right) => right.mtimeMs - left.mtimeMs)
    return images
  }

  /**
   * Read one stored image for serving.
   * @param file - `<sha256>.<ext>`; anything else is undefined, never a path.
   * @returns bytes and media type, or undefined when absent.
   */
  async read(file: string): Promise<StoredAvatarImage | undefined> {
    const mediaType = mediaTypeOfFile(file)
    if (mediaType === undefined || !AVATAR_FILE_PATTERN.test(file)) return undefined
    try {
      return { data: await readFile(join(this.root, file)), mediaType }
    } catch (error: unknown) {
      if (isErrnoCode(error, 'ENOENT')) return undefined
      throw error
    }
  }

  /**
   * Remove one stored image.
   * @param file - `<sha256>.<ext>`; anything else removes nothing.
   * @returns whether a file was actually removed.
   */
  async remove(file: string): Promise<boolean> {
    if (!AVATAR_FILE_PATTERN.test(file)) return false
    try {
      await rm(join(this.root, file))
      return true
    } catch (error: unknown) {
      if (isErrnoCode(error, 'ENOENT')) return false
      throw error
    }
  }
}

async function statOrUndefined(path: string): Promise<{ size: number; mtimeMs: number } | undefined> {
  try {
    return await stat(path)
  } catch (error: unknown) {
    if (isErrnoCode(error, 'ENOENT')) return undefined
    throw error
  }
}

function isErrnoCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code
}
