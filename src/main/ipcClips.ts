import { clipboard, ClipboardItem, ipcMain, nativeImage, shell, type IpcMainInvokeEvent } from 'electron'
import { MAX_CLIP_TEXT, RETENTION_CHOICES, type Clip, type ClipsPayload } from '@shared/clips'
import { CHANNELS } from '@shared/ipc'
import type { AppContext } from './context'
import { getClip, listClips } from './db/clips'
import { clipsDir } from './paths'
import {
  addImageClip,
  addTextClip,
  clipFilePath,
  clipToTask,
  createClipTrash,
  editClip,
  keepClip,
  markClipUsed,
  MAX_IMAGE_BYTES,
} from './services/clips'
import { updateSettings } from './services/settings'

const MAX_ID = 128

function id(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ID) throw new Error('Invalid id')
  return v
}

function clipText(v: unknown): string {
  if (typeof v !== 'string' || v.length > MAX_CLIP_TEXT) throw new Error('Text must be at most 200000 characters')
  return v
}

function imageBytes(v: unknown): Uint8Array {
  if (!(v instanceof Uint8Array) || v.length === 0 || v.length > MAX_IMAGE_BYTES) throw new Error('Image must be 1 byte to 20 MB')
  return v
}

function retention(v: unknown): number | null {
  if (!RETENTION_CHOICES.includes(v as number | null)) throw new Error('Keep clips 7, 30 or 90 days, or always')
  return v as number | null
}

/** The picture's width and height when Chromium's decoder knows the format (PNG and JPEG always). */
function sizeOf(bytes: Uint8Array): { width: number; height: number } | null {
  const image = nativeImage.createFromBuffer(Buffer.from(bytes))
  return image.isEmpty() ? null : image.getSize()
}

/** The picture as PNG bytes for the clipboard; a JPEG is converted, a GIF or WebP Chromium cannot decode is refused. */
function pngOf(dir: string, clip: Clip): Uint8Array<ArrayBuffer> {
  const file = clipFilePath(dir, clip)
  const image = file ? nativeImage.createFromPath(file) : null
  if (!image || image.isEmpty()) throw new Error('This picture cannot go on the clipboard')
  return new Uint8Array(image.toPNG())
}

/** 暫存: what the person pasted to keep, its pictures in the clips folder. */
export function registerClipHandlers(ctx: AppContext, appInfo: () => unknown): void {
  const { db } = ctx
  const dir = clipsDir()
  const trash = createClipTrash(dir)
  /** Runs a change and tells every window to refresh. */
  const handle = <A extends unknown[]>(channel: string, fn: (...args: A) => unknown): void => {
    ipcMain.handle(channel, (_e: IpcMainInvokeEvent, ...args: A) => {
      const result = fn(...args)
      ctx.broadcast()
      return result
    })
  }
  const requireClip = (v: unknown): Clip => {
    const clip = getClip(db, id(v))
    if (!clip) throw new Error('That clip is gone')
    return clip
  }

  ipcMain.handle(CHANNELS.getClips, (): ClipsPayload => ({ clips: listClips(db), retentionDays: ctx.settings().clipRetentionDays }))
  handle(CHANNELS.addTextClip, (t: unknown, kept: unknown) => addTextClip(db, clipText(t), Date.now(), { kept: kept === true }))
  handle(CHANNELS.addImageClip, (b: unknown) => {
    const bytes = imageBytes(b)
    return addImageClip(db, dir, bytes, sizeOf(bytes), Date.now())
  })
  handle(CHANNELS.editClip, (i: unknown, t: unknown) => editClip(db, id(i), clipText(t), Date.now()))
  handle(CHANNELS.keepClip, (i: unknown, kept: unknown) => keepClip(db, id(i), kept === true, Date.now()))
  handle(CHANNELS.copyClip, async (i: unknown) => {
    const clip = requireClip(i)
    if (clip.kind === 'image') {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([pngOf(dir, clip)], { type: 'image/png' }) })])
    } else {
      await clipboard.writeText(clip.text)
    }
    markClipUsed(db, clip.id, Date.now())
  })
  handle(CHANNELS.showClipInFolder, (i: unknown) => {
    const clip = requireClip(i)
    const file = clipFilePath(dir, clip)
    if (!file) throw new Error('Only pictures have a file')
    shell.showItemInFolder(file)
    markClipUsed(db, clip.id, Date.now())
  })
  handle(CHANNELS.clipToTask, (i: unknown) => clipToTask(db, id(i), Date.now()))
  handle(CHANNELS.removeClip, (i: unknown) => trash.remove(db, id(i)))
  handle(CHANNELS.undoRemoveClip, (i: unknown) => trash.restore(db, id(i)))
  handle(CHANNELS.setClipRetention, (days: unknown) => {
    updateSettings(db, { clipRetentionDays: retention(days) })
    return appInfo()
  })
}
