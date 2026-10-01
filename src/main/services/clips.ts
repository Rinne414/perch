import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { kindOfText, MAX_CLIP_TEXT, tagsOf, type Clip } from '@shared/clips'
import type { Item } from '@shared/types'
import { deleteClip, getClip, insertClip, listUnusedSince, setClipKept, touchClip, updateClipText } from '../db/clips'
import { createItem } from '../db/items'

const DAY_MS = 86_400_000
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** Deleted pictures wait this long in .deleted, so restoring a week-old backup still finds them. */
const KEEP_DELETED_DAYS = 8
const UNDO_MS = 60_000
const ASIDE = '.deleted'
const MAX_TITLE = 200

export type ImageType = 'png' | 'jpeg' | 'gif' | 'webp'
const EXTENSION: Readonly<Record<ImageType, string>> = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' }

const startsWith = (bytes: Uint8Array, at: number, sig: readonly number[]): boolean =>
  bytes.length >= at + sig.length && sig.every((b, i) => bytes[at + i] === b)
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))

/** The picture format by its first bytes; whatever a file claims to be does not count. */
export function imageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(bytes, 0, ascii('GIF87a')) || startsWith(bytes, 0, ascii('GIF89a'))) return 'gif'
  if (startsWith(bytes, 0, ascii('RIFF')) && startsWith(bytes, 8, ascii('WEBP'))) return 'webp'
  return null
}

function cleanText(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length > MAX_CLIP_TEXT) throw new Error('Text is too long to keep here')
  return trimmed
}

export function addTextClip(db: DatabaseSync, text: string, now: number): Clip {
  const value = cleanText(text)
  if (!value) throw new Error('Nothing to keep')
  const clip: Clip = {
    id: randomUUID(),
    kind: kindOfText(value),
    text: value,
    file: null,
    width: null,
    height: null,
    bytes: null,
    tags: tagsOf(value),
    kept: false,
    createdAt: now,
    usedAt: now,
  }
  insertClip(db, clip)
  return clip
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Saves a pasted picture as a file in a month folder (`2026-10/<id>.png`) and records it. */
export function addImageClip(
  db: DatabaseSync,
  dir: string,
  bytes: Uint8Array,
  size: { readonly width: number; readonly height: number } | null,
  now: number,
): Clip {
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Image is larger than 20 MB')
  const type = imageType(bytes)
  if (!type) throw new Error('Not a PNG, JPEG, GIF or WebP picture')
  const id = randomUUID()
  const date = new Date(now)
  const month = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
  const name = `${id}.${EXTENSION[type]}`
  mkdirSync(join(dir, month), { recursive: true })
  writeFileSync(join(dir, month, name), bytes)
  const clip: Clip = {
    id,
    kind: 'image',
    text: '',
    file: `${month}/${name}`,
    width: size?.width ?? null,
    height: size?.height ?? null,
    bytes: bytes.length,
    tags: [],
    kept: false,
    createdAt: now,
    usedAt: now,
  }
  insertClip(db, clip)
  return clip
}

/** The picture's file, only when it really lies inside the clips folder. */
export function clipFilePath(dir: string, clip: Clip): string | null {
  if (!clip.file) return null
  const root = resolve(dir)
  const full = resolve(root, ...clip.file.split('/'))
  const rel = relative(root, full)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? full : null
}

/** New text, link or caption; its tags follow. */
export function editClip(db: DatabaseSync, id: string, text: string, now: number): Clip {
  const value = cleanText(text)
  const clip = getClip(db, id)
  if (!clip) throw new Error(`Clip not found: ${id}`)
  if (!value && clip.kind !== 'image') throw new Error('A text clip needs its text')
  return updateClipText(db, id, value, now)
}

export const keepClip = (db: DatabaseSync, id: string, kept: boolean, now: number): Clip => setClipKept(db, id, kept, now)

export const markClipUsed = (db: DatabaseSync, id: string, now: number): void => touchClip(db, id, now)

/** 變成待辦: the first line of the text (or caption) waits in 隨手記. */
export function clipToTask(db: DatabaseSync, id: string, now: number): Item {
  const clip = getClip(db, id)
  if (!clip) throw new Error(`Clip not found: ${id}`)
  const firstLine = clip.text.split('\n').find((l) => l.trim())?.trim().slice(0, MAX_TITLE)
  if (!firstLine) throw new Error('A picture needs a caption to become a task')
  touchClip(db, id, now)
  return createItem(db, { kind: 'idea', title: firstLine }, now)
}

const asidePath = (dir: string, clip: Clip): string => join(dir, ASIDE, clip.file!.split('/').at(-1)!)

/** Moves a deleted clip's picture aside; it is removed for good after KEEP_DELETED_DAYS. */
function setAside(dir: string, clip: Clip, now: number): void {
  const file = clipFilePath(dir, clip)
  if (!file || !existsSync(file)) return
  mkdirSync(join(dir, ASIDE), { recursive: true })
  const target = asidePath(dir, clip)
  renameSync(file, target)
  // The wait counts from the deletion, not from when the picture was pasted.
  utimesSync(target, new Date(now), new Date(now))
}

function bringBack(dir: string, clip: Clip): void {
  const file = clipFilePath(dir, clip)
  const aside = clip.file ? asidePath(dir, clip) : null
  if (!file || !aside || !existsSync(aside)) return
  mkdirSync(resolve(file, '..'), { recursive: true })
  renameSync(aside, file)
}

export interface ClipTrash {
  remove(db: DatabaseSync, id: string): void
  /** False once the minute has passed (or nothing was deleted). */
  restore(db: DatabaseSync, id: string): boolean
}

/** Deletes at once and keeps a one-minute way back, like tasks. */
export function createClipTrash(dir: string, clock: () => number = Date.now): ClipTrash {
  const held = new Map<string, { clip: Clip; at: number }>()
  return {
    remove(db, id) {
      const clip = getClip(db, id)
      if (!clip) throw new Error(`Clip not found: ${id}`)
      deleteClip(db, id)
      setAside(dir, clip, clock())
      held.set(id, { clip, at: clock() })
    },
    restore(db, id) {
      const entry = held.get(id)
      held.delete(id)
      if (!entry || clock() - entry.at > UNDO_MS) return false
      bringBack(dir, entry.clip)
      insertClip(db, entry.clip)
      return true
    },
  }
}

function purgeAside(dir: string, now: number): void {
  const aside = join(dir, ASIDE)
  let names: string[]
  try {
    names = readdirSync(aside)
  } catch {
    return
  }
  for (const name of names) {
    const file = join(aside, name)
    if (statSync(file).mtimeMs < now - KEEP_DELETED_DAYS * DAY_MS) rmSync(file, { force: true })
  }
}

/** Clears clips that are not kept and were unused for `retentionDays`; returns how many went. */
export function clearExpiredClips(db: DatabaseSync, dir: string, now: number, retentionDays: number | null): number {
  const expired = retentionDays === null ? [] : listUnusedSince(db, now - retentionDays * DAY_MS)
  for (const clip of expired) {
    deleteClip(db, clip.id)
    setAside(dir, clip, now)
  }
  purgeAside(dir, now)
  return expired.length
}
