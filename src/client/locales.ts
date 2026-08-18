/**
 * Dictionaries for the Background settings page.
 *
 * @module @zoytown/dsh-avatar/client/locales
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.dshAvatar'

const en = {
  'nav': 'Background',
  'intro': 'Upload an image and use it as the wallpaper behind the whole dsh window.',
  'readonly.note': 'Preferences are stored on the host and can only be changed from a local (loopback) browser. This page is read-only here.',
  'upload.cta': 'Upload image',
  'upload.hint': 'Click or drop images here — png / jpg / webp / gif, up to {mb} MB each',
  'upload.hint.generic': 'Click or drop images here — png / jpg / webp / gif',
  'upload.busy': 'Uploading…',
  'issue.empty': 'That file is empty.',
  'issue.too-large': 'Too large — the limit is {mb} MB per image.',
  'issue.too-large.generic': 'Too large — the image exceeds the host’s size limit.',
  'issue.unsupported-type': 'Not a supported image — png, jpg, webp, or gif only.',
  'issue.type-mismatch': 'The file content does not match its extension.',
  'issue.transport': 'Upload failed: {message}',
  'gallery.none': 'None',
  'gallery.none.hint': 'No wallpaper — the plain theme background',
  'gallery.delete': 'Delete this image',
  'gallery.retry': 'Retry',
  'gallery.error': 'Could not load the gallery: {message}',
  'gallery.empty.title': 'No wallpapers yet',
  'gallery.empty.body': 'Drop an image above to get started.',
  'missing.note': 'The selected wallpaper file is gone; the background is off until you pick another.',
  'controls.mask': 'Veil',
  'controls.mask.hint': 'Higher is easier to read; lower shows more image',
  'controls.blur': 'Blur',
  'controls.fill': 'Fit',
  'fill.cover': 'Fill',
  'fill.contain': 'Fit',
  'fill.tile': 'Tile',
}

const zh: typeof en = {
  'nav': '背景',
  'intro': '上传图片作为整个 dsh 窗口的壁纸背景。',
  'readonly.note': '偏好保存在宿主机上，只能从本机（loopback）浏览器修改。当前页面为只读。',
  'upload.cta': '上传图片',
  'upload.hint': '点击或拖拽图片到这里——png / jpg / webp / gif，单张不超过 {mb} MB',
  'upload.hint.generic': '点击或拖拽图片到这里——png / jpg / webp / gif',
  'upload.busy': '正在上传…',
  'issue.empty': '这个文件是空的。',
  'issue.too-large': '图片过大——单张上限 {mb} MB。',
  'issue.too-large.generic': '图片过大——超出了宿主配置的大小上限。',
  'issue.unsupported-type': '不支持的图片格式——仅支持 png、jpg、webp、gif。',
  'issue.type-mismatch': '文件内容与其扩展名不符。',
  'issue.transport': '上传失败：{message}',
  'gallery.none': '无背景',
  'gallery.none.hint': '不使用壁纸，恢复纯色主题背景',
  'gallery.delete': '删除这张图片',
  'gallery.retry': '重试',
  'gallery.error': '无法加载图库：{message}',
  'gallery.empty.title': '还没有壁纸',
  'gallery.empty.body': '把图片拖到上方，开始使用。',
  'missing.note': '选中的壁纸文件已不存在，背景已关闭，请重新选择。',
  'controls.mask': '遮罩强度',
  'controls.mask.hint': '越高文字越清晰，越低图片越明显',
  'controls.blur': '背景模糊',
  'controls.fill': '填充方式',
  'fill.cover': '铺满',
  'fill.contain': '完整显示',
  'fill.tile': '平铺',
}

/** Dictionaries in the shape `ctx.locale.register` expects. */
export const dictionaries = { en, zh }

/** Substitute `{name}` placeholders. */
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key]
    return value === undefined ? match : String(value)
  })
}
