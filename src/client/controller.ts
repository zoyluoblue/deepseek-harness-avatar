/**
 * Browser-side wallpaper state: one controller shared by the settings page
 * and the background applier, exposing a `useSyncExternalStore`-shaped pair
 * (`subscribe` / `getSnapshot`) rather than a framework hook contract, so
 * components depend only on React itself.
 *
 * Preference writes are optimistic: a slider drag updates the view (and thus
 * the live background) immediately, while the durable write is debounced and
 * revision-fenced by the settings scope. The scope snapshot remains the
 * source of truth — a rejected write falls back to it on the next publish.
 *
 * @module @zoytown/dsh-avatar/client/controller
 */

import {
  AVATAR_FILE_PATTERN,
  AVATAR_SETTINGS_DEFAULTS,
  BLUR_MAX_PX,
  MASK_OPACITY_MAX,
  sniffMediaType,
  WIRE_VERSION,
  type AvatarDeleteResponse,
  type AvatarImage,
  type AvatarListResponse,
  type AvatarSettings,
  type AvatarUploadErrorCode,
  type AvatarUploadResponse,
} from '../wire.ts'
import { bytesToBase64 } from './base64.ts'
import type { BackgroundSpec } from './background.ts'
import type { RpcResultLike, SettingsScope } from './runtime.d.ts'

/** Media types the file input accepts; the host re-sniffs regardless. */
export const ACCEPTED_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** Upload refusals plus the client-only transport failure. */
export type UploadIssueCode = AvatarUploadErrorCode | 'transport'

/** One surfaced refusal. */
export interface UploadIssue {
  code: UploadIssueCode
  message: string
  /** On `too-large`: the authoritative cap the refusing side reported. */
  maxImageBytes?: number
}

/** What the settings page renders. */
export interface AvatarView {
  /** `idle` before the first list, `loading` during it. */
  readonly galleryStatus: 'idle' | 'loading' | 'ready' | 'error'
  /** Newest first. */
  readonly images: readonly AvatarImage[]
  /** Gallery transport failure, shown with a retry. */
  readonly galleryError: string | null
  /** Whether an upload batch is in flight. */
  readonly uploading: boolean
  /** Last upload refusal; cleared by the next attempt. */
  readonly uploadIssue: UploadIssue | null
  /** Effective preferences: durable value overlaid with pending edits. */
  readonly prefs: AvatarSettings
  /** False on a remote (non-loopback) browser — the whole page goes read-only. */
  readonly writable: boolean
  /** `memory` marks the remote-browser degradation. */
  readonly prefsMode: 'host' | 'memory'
  /** Host-configured per-image cap, once the first list returns. */
  readonly maxImageBytes: number | null
  /** The selection points at a file the loaded gallery does not contain. */
  readonly selectedMissing: boolean
}

/** Constructor seams, injectable for tests. */
export interface AvatarControllerDeps {
  /** One channel call: endpoint + payload, transport pre-bound. */
  rpc: (endpoint: string, payload: unknown) => Promise<RpcResultLike<unknown>>
  scope: SettingsScope<AvatarSettings>
  /** Debounce for durable slider writes. */
  persistDelayMs?: number
}

const DEFAULT_PERSIST_DELAY_MS = 300

/** Shared wallpaper state for every browser surface in this plugin. */
export class AvatarController {
  private readonly rpc: AvatarControllerDeps['rpc']
  private readonly scope: SettingsScope<AvatarSettings>
  private readonly persistDelayMs: number

  private readonly listeners = new Set<() => void>()
  private view: AvatarView
  /** Fields edited locally whose durable write has not landed yet. */
  private readonly pending = new Map<keyof AvatarSettings, string | number>()
  private readonly persistTimers = new Map<keyof AvatarSettings, ReturnType<typeof setTimeout>>()
  private listInflight: Promise<void> | null = null
  private started = false
  private disposed = false
  private readonly unsubscribeScope: () => void

  constructor(deps: AvatarControllerDeps) {
    this.rpc = deps.rpc
    this.scope = deps.scope
    this.persistDelayMs = deps.persistDelayMs ?? DEFAULT_PERSIST_DELAY_MS
    this.view = this.composeView({
      galleryStatus: 'idle',
      images: [],
      galleryError: null,
      uploading: false,
      uploadIssue: null,
      maxImageBytes: null,
    })
    this.unsubscribeScope = this.scope.subscribe(() => { this.publish({}) })
  }

  /** Subscribe to view changes; returns the unsubscriber. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Current view; reference-stable between changes so React can bail out. */
  readonly getSnapshot = (): AvatarView => this.view

  /** Load the gallery once; later calls are free. */
  readonly ensure = (): void => {
    if (this.started) return
    this.started = true
    void this.loadGallery()
  }

  /** Explicit re-list (retry button). */
  readonly refresh = (): void => {
    void this.loadGallery()
  }

  /**
   * The background layer's input, derived from the same view the page
   * renders. Null when no wallpaper should be drawn. While the gallery is
   * still loading the selection is trusted, so the wallpaper survives a
   * reload without flashing away.
   */
  readonly backgroundSpec = (): BackgroundSpec | null => {
    const { prefs, selectedMissing } = this.view
    if (prefs.selected === '' || !AVATAR_FILE_PATTERN.test(prefs.selected)) return null
    if (selectedMissing) return null
    return {
      file: prefs.selected,
      maskOpacity: prefs.maskOpacity,
      blur: prefs.blur,
      fill: prefs.fill,
    }
  }

  /**
   * Upload a batch. Files are sent sequentially; the first refusal stops the
   * batch and shows as `uploadIssue`. The last stored image becomes the
   * active wallpaper — uploading is an expression of intent to use it.
   */
  readonly upload = (files: readonly File[]): void => {
    void this.runUpload(files)
  }

  /** Delete one stored image; deleting the active wallpaper clears it. */
  readonly remove = (file: string): void => {
    void this.runRemove(file)
  }

  /** Make one stored image the active wallpaper. */
  readonly select = (file: string): void => {
    if (!AVATAR_FILE_PATTERN.test(file) || !this.view.writable) return
    this.setPreference('selected', file)
  }

  /** Turn the wallpaper off (keeps the gallery). */
  readonly clearBackground = (): void => {
    if (!this.view.writable) return
    this.setPreference('selected', '')
  }

  /** Veil opacity, 0–MASK_OPACITY_MAX; live on the background, debounced to disk. */
  readonly setMaskOpacity = (value: number): void => {
    if (!this.view.writable) return
    this.setPreference('maskOpacity', Math.min(Math.max(value, 0), MASK_OPACITY_MAX))
  }

  /** Wallpaper blur radius in px; live on the background, debounced to disk. */
  readonly setBlur = (value: number): void => {
    if (!this.view.writable) return
    this.setPreference('blur', Math.min(Math.max(value, 0), BLUR_MAX_PX))
  }

  /** Fill mode. */
  readonly setFill = (value: AvatarSettings['fill']): void => {
    if (!this.view.writable) return
    this.setPreference('fill', value)
  }

  /** Stop publishing and drop pending timers; in-flight work settles into nothing. */
  readonly dispose = (): void => {
    this.disposed = true
    this.unsubscribeScope()
    for (const timer of this.persistTimers.values()) clearTimeout(timer)
    this.persistTimers.clear()
    this.listeners.clear()
  }

  private composeView(overrides: Partial<AvatarView>): AvatarView {
    const snapshot = this.scope.getSnapshot()
    const durable: AvatarSettings = { ...AVATAR_SETTINGS_DEFAULTS, ...snapshot.value ?? {} }
    const prefs: AvatarSettings = { ...durable, ...Object.fromEntries(this.pending) }
    const base: Omit<AvatarView, 'prefs' | 'writable' | 'prefsMode' | 'selectedMissing'> = {
      galleryStatus: this.view?.galleryStatus ?? 'idle',
      images: this.view?.images ?? [],
      galleryError: this.view?.galleryError ?? null,
      uploading: this.view?.uploading ?? false,
      uploadIssue: this.view?.uploadIssue ?? null,
      maxImageBytes: this.view?.maxImageBytes ?? null,
      ...overrides,
    }
    return {
      ...base,
      prefs,
      writable: snapshot.writable,
      prefsMode: snapshot.mode,
      selectedMissing: prefs.selected !== ''
        && base.galleryStatus === 'ready'
        && !base.images.some(image => image.file === prefs.selected),
    }
  }

  private publish(overrides: Partial<AvatarView>): void {
    if (this.disposed) return
    this.view = this.composeView(overrides)
    // A selection this gallery has never seen usually means another tab (or
    // an external tool) uploaded it after our list — re-list once per unseen
    // value before letting `selectedMissing` turn the wallpaper off for good.
    // The retry must be a FRESH read: joining a flight that started before
    // the selection existed would consume the one retry on stale data.
    const { selectedMissing, prefs } = this.view
    if (selectedMissing && this.missingRefreshedFor !== prefs.selected) {
      this.missingRefreshedFor = prefs.selected
      this.freshList()
    }
    for (const listener of this.listeners) listener()
  }

  /** The selected value we already re-listed for (one retry per value). */
  private missingRefreshedFor = ''

  /** Whether a fresh follow-up list is already queued behind the in-flight one. */
  private freshListQueued = false

  /**
   * Guarantee a list read that STARTS from now: begins one immediately when
   * idle, otherwise queues exactly one follow-up behind the current flight
   * (whose snapshot may predate the state this read is meant to observe).
   */
  private freshList(): void {
    if (this.listInflight === null) {
      void this.loadGallery()
      return
    }
    if (this.freshListQueued) return
    this.freshListQueued = true
    void this.listInflight.then(() => {
      this.freshListQueued = false
      if (!this.disposed) void this.loadGallery()
    })
  }

  /**
   * Optimistic preference write: the view changes now, the durable write is
   * debounced per field, and the pending overlay is dropped once the write
   * lands (or fails — then the durable value shows again, which is the
   * honest outcome of a rejected write).
   */
  private setPreference(field: keyof AvatarSettings, value: string | number): void {
    this.pending.set(field, value)
    const existing = this.persistTimers.get(field)
    if (existing !== undefined) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.persistTimers.delete(field)
      void this.scope.set(field, value)
        .catch(() => undefined)
        .finally(() => {
          if (this.pending.get(field) === value) this.pending.delete(field)
          this.publish({})
        })
    }, field === 'selected' ? 0 : this.persistDelayMs)
    this.persistTimers.set(field, timer)
    this.publish({})
  }

  /** Start or join the single in-flight list. */
  private loadGallery(): Promise<void> {
    if (this.listInflight !== null) return this.listInflight
    this.publish({ galleryStatus: 'loading', galleryError: null })
    const task = this.runList().finally(() => {
      this.listInflight = null
    })
    this.listInflight = task
    return task
  }

  /** One list read. Never rejects: every failure is published into the view. */
  private async runList(): Promise<void> {
    try {
      const result = await this.rpc('list', {})
      const payload = unwrapList(result)
      this.publish({
        galleryStatus: 'ready',
        images: payload.images,
        galleryError: null,
        maxImageBytes: payload.maxImageBytes,
      })
    } catch (error: unknown) {
      this.publish({ galleryStatus: 'error', galleryError: messageOf(error) })
    }
  }

  private async runUpload(files: readonly File[]): Promise<void> {
    if (files.length === 0 || this.view.uploading || !this.view.writable) return
    this.publish({ uploading: true, uploadIssue: null })
    let lastStored: AvatarImage | undefined
    try {
      for (const file of files) {
        const outcome = await this.uploadOne(file)
        if (outcome.issue !== undefined) {
          this.publish({ uploading: false, uploadIssue: outcome.issue })
          return
        }
        lastStored = outcome.image ?? lastStored
      }
      this.publish({ uploading: false })
      if (lastStored !== undefined) this.select(lastStored.file)
    } catch (error: unknown) {
      this.publish({ uploading: false, uploadIssue: { code: 'transport', message: messageOf(error) } })
    }
  }

  /** Upload one file; exactly one of `image` / `issue` comes back. */
  private async uploadOne(file: File): Promise<{
    image?: AvatarImage
    issue?: UploadIssue
  }> {
    if (file.type !== '' && !(ACCEPTED_MEDIA_TYPES as readonly string[]).includes(file.type)) {
      return { issue: { code: 'unsupported-type', message: file.type } }
    }
    const cap = this.view.maxImageBytes
    if (cap !== null && file.size > cap) {
      return { issue: { code: 'too-large', message: `${file.size}`, maxImageBytes: cap } }
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    // The declared type comes from the bytes, not the OS: File.type is derived
    // from the extension and is '' for extensionless files, while the host
    // refuses any declared/sniffed mismatch — sniffing here means an
    // extensionless JPEG uploads instead of dying with a misleading refusal.
    const declared = sniffMediaType(bytes)
    if (declared === undefined) {
      return { issue: { code: 'unsupported-type', message: file.type } }
    }
    const result = await this.rpc('upload', { data: bytesToBase64(bytes), mediaType: declared })
    if (!result.ok) return { issue: { code: 'transport', message: result.error.message } }
    const payload = asUploadResponse(result.value)
    if (payload.error !== undefined) return { issue: payload.error }
    if (payload.image === undefined) {
      return { issue: { code: 'transport', message: 'upload response carried neither image nor error' } }
    }
    const image = payload.image
    const rest = this.view.images.filter(existing => existing.file !== image.file)
    this.publish({ images: [image, ...rest], galleryStatus: 'ready' })
    return { image }
  }

  private async runRemove(file: string): Promise<void> {
    if (!this.view.writable) return
    try {
      const result = await this.rpc('delete', { file })
      if (!result.ok) return
      asDeleteResponse(result.value)
      // Clear the selection BEFORE the file leaves the gallery: the reverse
      // order opens a transient selected-missing state that the compensating
      // re-list above would react to.
      if (this.view.prefs.selected === file) this.clearBackground()
      this.publish({ images: this.view.images.filter(image => image.file !== file) })
    } catch {
      // Deletion is retryable by clicking again; the gallery keeps the tile.
    }
  }
}

/** The business face the settings page receives through the slot inject factory. */
export interface AvatarInjected {
  readonly controller: Pick<AvatarController,
    'subscribe' | 'getSnapshot' | 'ensure' | 'refresh' | 'upload' | 'remove'
    | 'select' | 'clearBackground' | 'setMaskOpacity' | 'setBlur' | 'setFill'>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function unwrapList(result: RpcResultLike<unknown>): AvatarListResponse {
  if (!result.ok) throw new Error(result.error.message)
  const value = result.value as Partial<AvatarListResponse> | null
  if (value === null || typeof value !== 'object' || value.v !== WIRE_VERSION || !Array.isArray(value.images)) {
    throw new Error('avatar list response has an unexpected shape (host/client version skew?)')
  }
  return { v: WIRE_VERSION, images: value.images, maxImageBytes: value.maxImageBytes ?? 0 }
}

function asUploadResponse(value: unknown): AvatarUploadResponse {
  const payload = value as Partial<AvatarUploadResponse> | null
  if (payload === null || typeof payload !== 'object' || payload.v !== WIRE_VERSION) {
    throw new Error('avatar upload response has an unexpected shape (host/client version skew?)')
  }
  return payload as AvatarUploadResponse
}

function asDeleteResponse(value: unknown): AvatarDeleteResponse {
  const payload = value as Partial<AvatarDeleteResponse> | null
  if (payload === null || typeof payload !== 'object' || payload.v !== WIRE_VERSION) {
    throw new Error('avatar delete response has an unexpected shape (host/client version skew?)')
  }
  return payload as AvatarDeleteResponse
}
