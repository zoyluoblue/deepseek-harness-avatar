/**
 * The Background settings page: dropzone + gallery grid + readability
 * controls. Pure view over the controller face — every state transition lives
 * in the controller, every string in the dictionaries.
 *
 * @module @zoytown/dsh-avatar/client/AvatarSection
 */

import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, DragEvent, ReactElement } from 'react'
import { AVATAR_IMAGE_ROUTE, BLUR_MAX_PX, MASK_OPACITY_MAX, type AvatarImage, type AvatarSettings } from '../wire.ts'
import css from './AvatarSection.module.css'
import { ACCEPTED_MEDIA_TYPES, type AvatarInjected, type UploadIssue } from './controller.ts'
import { interpolate } from './locales.ts'
import type { Translate } from './runtime.d.ts'

/** Props: the locale seat plus the inject-factory face. */
export interface AvatarSectionProps extends AvatarInjected {
  /** Injected by the slot's `locale` declaration. */
  t: Translate
}

const FILL_MODES: readonly AvatarSettings['fill'][] = ['cover', 'contain', 'tile']

function megabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024))
}

/** The settings page component registered into `settings.section`. */
export function AvatarSection({ t, controller }: AvatarSectionProps): ReactElement {
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => { controller.ensure() }, [controller])

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const editable = view.writable && !view.uploading

  const onPick = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files !== null && files.length > 0) controller.upload([...files])
    // Same file re-picked later must fire change again.
    event.target.value = ''
  }, [controller])

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (!editable) return
    const files = [...event.dataTransfer.files]
    if (files.length > 0) controller.upload(files)
  }, [controller, editable])

  // The cap is host configuration; before the first list reports it there is
  // no number worth showing, so the copy goes generic instead of guessing.
  const capMb = view.maxImageBytes === null ? null : megabytes(view.maxImageBytes)

  return (
    <section className={css.section} onDragOver={(event) => {
      event.preventDefault()
      if (editable) setDragging(true)
    }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <header>
        <div className={css.title}>{t('nav')}</div>
        <p className={css.intro}>{t('intro')}</p>
      </header>

      {!view.writable && <div className={clsx(css.note, css.noteWarn)}>{t('readonly.note')}</div>}

      <div
        role="button"
        tabIndex={editable ? 0 : -1}
        aria-disabled={!editable}
        className={clsx(css.dropzone, dragging && css.dropzoneActive, !editable && css.dropzoneDisabled)}
        onClick={() => { if (editable) inputRef.current?.click() }}
        onKeyDown={(event) => {
          if (editable && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            inputRef.current?.click()
          }
        }}
      >
        <span className={css.dropzoneCta}>{view.uploading ? t('upload.busy') : t('upload.cta')}</span>
        <span>{capMb === null ? t('upload.hint.generic') : interpolate(t('upload.hint'), { mb: capMb })}</span>
        <input
          ref={inputRef}
          className={css.fileInput}
          type="file"
          accept={ACCEPTED_MEDIA_TYPES.join(',')}
          multiple
          onChange={onPick}
        />
      </div>

      {view.uploadIssue !== null && (
        <div className={clsx(css.note, css.noteError)}>
          {renderIssue(t, view.uploadIssue, view.maxImageBytes)}
        </div>
      )}

      {view.selectedMissing && <div className={clsx(css.note, css.noteWarn)}>{t('missing.note')}</div>}

      {view.galleryStatus === 'error' && (
        <div className={clsx(css.note, css.noteError)}>
          {interpolate(t('gallery.error'), { message: view.galleryError ?? '' })}
          {' '}
          <button type="button" className={css.segment} onClick={controller.refresh}>{t('gallery.retry')}</button>
        </div>
      )}

      {(view.galleryStatus === 'ready' || view.images.length > 0) && (
        view.images.length === 0
          ? (
            <div className={css.empty}>
              <div className={css.emptyTitle}>{t('gallery.empty.title')}</div>
              {t('gallery.empty.body')}
            </div>
          )
          : (
            <div className={css.grid}>
              <button
                type="button"
                title={t('gallery.none.hint')}
                disabled={!view.writable}
                className={clsx(
                  css.tile, css.tileNone,
                  view.prefs.selected === '' && css.tileSelected,
                  !view.writable && css.tileDisabled,
                )}
                onClick={controller.clearBackground}
              >
                {t('gallery.none')}
              </button>
              {view.images.map(image => (
                <GalleryTile
                  key={image.file}
                  image={image}
                  selected={view.prefs.selected === image.file}
                  writable={view.writable}
                  deleteLabel={t('gallery.delete')}
                  onSelect={controller.select}
                  onRemove={controller.remove}
                />
              ))}
            </div>
          )
      )}

      {view.prefs.selected !== '' && !view.selectedMissing && (
        <div className={css.controls}>
          <div className={css.controlRow}>
            <span className={css.controlLabel}>{t('controls.mask')}</span>
            <input
              type="range"
              className={css.slider}
              min={0}
              max={Math.round(MASK_OPACITY_MAX * 100)}
              step={1}
              value={Math.round(view.prefs.maskOpacity * 100)}
              disabled={!view.writable}
              onChange={event => controller.setMaskOpacity(Number(event.target.value) / 100)}
            />
            <span className={css.controlValue}>{Math.round(view.prefs.maskOpacity * 100)}%</span>
          </div>
          <div className={css.controlHint}>{t('controls.mask.hint')}</div>
          <div className={css.controlRow}>
            <span className={css.controlLabel}>{t('controls.blur')}</span>
            <input
              type="range"
              className={css.slider}
              min={0}
              max={BLUR_MAX_PX}
              step={1}
              value={view.prefs.blur}
              disabled={!view.writable}
              onChange={event => controller.setBlur(Number(event.target.value))}
            />
            <span className={css.controlValue}>{view.prefs.blur}px</span>
          </div>
          <div className={css.controlRow}>
            <span className={css.controlLabel}>{t('controls.fill')}</span>
            <div className={css.segments}>
              {FILL_MODES.map(mode => (
                <button
                  key={mode}
                  type="button"
                  disabled={!view.writable}
                  className={clsx(css.segment, view.prefs.fill === mode && css.segmentActive)}
                  onClick={() => controller.setFill(mode)}
                >
                  {t(`fill.${mode}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * Refusal copy. `too-large` names the cap the refusing side reported (falling
 * back to the listed cap), or goes generic when no authoritative number has
 * arrived yet — the host default is deliberately not duplicated here.
 */
function renderIssue(t: Translate, issue: UploadIssue, listedCap: number | null): string {
  if (issue.code === 'transport') return interpolate(t('issue.transport'), { message: issue.message })
  if (issue.code === 'too-large') {
    const capBytes = issue.maxImageBytes ?? listedCap
    return capBytes === null
      ? t('issue.too-large.generic')
      : interpolate(t('issue.too-large'), { mb: megabytes(capBytes) })
  }
  return t(`issue.${issue.code}`)
}

interface GalleryTileProps {
  image: AvatarImage
  selected: boolean
  writable: boolean
  deleteLabel: string
  onSelect: (file: string) => void
  onRemove: (file: string) => void
}

function GalleryTile({ image, selected, writable, deleteLabel, onSelect, onRemove }: GalleryTileProps): ReactElement {
  return (
    <button
      type="button"
      disabled={!writable}
      className={clsx(css.tile, selected && css.tileSelected, !writable && css.tileDisabled)}
      onClick={() => onSelect(image.file)}
    >
      <img
        className={css.tileImage}
        src={`${AVATAR_IMAGE_ROUTE}/${image.file}`}
        alt=""
        loading="lazy"
        draggable={false}
      />
      {writable && (
        <span
          role="button"
          tabIndex={0}
          aria-label={deleteLabel}
          title={deleteLabel}
          className={css.tileDelete}
          onClick={(event) => {
            event.stopPropagation()
            onRemove(image.file)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              event.stopPropagation()
              onRemove(image.file)
            }
          }}
        >
          ×
        </span>
      )}
    </button>
  )
}
