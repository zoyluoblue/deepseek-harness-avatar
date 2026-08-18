/**
 * Minimal local declarations for the browser-side services this plugin uses.
 *
 * WHY THESE ARE LOCAL: the authoritative types live in
 * `@deepseek-ai/dsh-client-runtime` and its peer client packages, whose npm
 * installability has been unreliable (the sibling token plugin records a 404
 * on a transitive dependency). That blocks type checking only, never the
 * build: every one of these packages is in the bundler's `external` list or
 * answered by the loader's frozen module table at runtime.
 *
 * Each shape below mirrors upstream and cites its source. Keep them narrow —
 * a smaller surface is a smaller lie.
 *
 * @module @zoytown/dsh-avatar/client/runtime
 */

/** Registration options for a list slot (ui-slots `src/index.ts:490-496, 527-550`). */
export interface SlotListOptions {
  name: string
  /** Required for list slots; a fresh id is added beside the shipped entries. */
  id: string
  /** Sort key within the list. */
  order?: number
  /**
   * Tab label. Typed optional upstream but effectively required — an omitted
   * label renders a blank button, with no fallback to the id. Pass a thunk so
   * a language switch relabels without re-registering.
   */
  label?: string | (() => string)
  /** Dictionary namespace; declaring it puts a typed `t` on the component. */
  locale?: string
  /** Factory whose return value is spread onto the component's props. */
  inject?: () => Record<string, unknown>
}

/** The two slot methods this plugin calls. */
export interface SlotsService {
  /**
   * Run `body` once the named slot has been DECLARED, and re-run it if the
   * declaration is replaced. A slot that never appears is a silent no-op —
   * which is exactly the desired degradation when the settings shell is not
   * part of the composition.
   */
  inject(name: string, body: () => void): void
  register(options: SlotListOptions, component: unknown): () => void
}

/** Dictionary registration and lookup (client-locale). */
export interface LocaleService {
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
  bind(namespace: string): (key: string) => string
}

/** Business error of one RPC call (apiproxy `src/api/rpc.ts:105-112`, widened to the fields we read). */
export interface RpcErrorLike {
  code: string
  message: string
}

/** Business success/failure result (apiproxy `src/api/rpc.ts:112`). */
export type RpcResultLike<T> = { ok: true; value: T } | { ok: false; error: RpcErrorLike }

/** Generic unary RPC caller (connection `src/rpc.ts:62-77`). */
export interface ConnectionService {
  readonly rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResultLike<unknown>>
  }
}

/** One scope snapshot (client-runtime `src/client/contract/settings-scope.ts:11-37`). */
export interface SettingsScopeSnapshot<T> {
  /** `unavailable` is the remote-browser degradation, not an error. */
  status: 'loading' | 'ready' | 'unavailable'
  /** Resolved section (base + user layers), undefined until loaded. */
  value: T | undefined
  /** Undefined before the first Host view (upstream contract). */
  revision: number | undefined
  writable: boolean
  mode: 'host' | 'memory'
}

/** Reactive settings scope (client-runtime `src/client/contract/settings-scope.ts:56-81`). */
export interface SettingsScope<T> {
  getSnapshot(): SettingsScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

/** The binder service (ui-settings `src/client/settings-scope.ts:227-269`). */
export interface SettingsScopeBinder {
  bind<T>(spec: { namespace: string; decode?: (section: unknown) => T | undefined }): SettingsScope<T>
}

/** One override-layer token value; both palette modes are mandatory (ui-theme `src/client/index.ts:50-58`). */
export interface ThemeTokenModes {
  light: string
  dark: string
}

/**
 * The one theme method this plugin calls (ui-theme `src/client/index.ts:281-290`).
 * Same source = the whole layer is replaced and restacked; the returned
 * disposer removes exactly the layer its call created.
 */
export interface ThemeService {
  overrideTokens(source: string, tokens: Record<string, ThemeTokenModes>): () => void
}

/** The slice of the browser context this plugin touches. */
export interface ClientContextLike {
  readonly slots: SlotsService
  readonly locale: LocaleService
  readonly connection: ConnectionService
  readonly settingsScope: SettingsScopeBinder
  readonly theme: ThemeService
  effect(body: () => unknown, label?: string): void
}

/** Localized label lookup handed to a component that declared `locale`. */
export type Translate = (key: string) => string
