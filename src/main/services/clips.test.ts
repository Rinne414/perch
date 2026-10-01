import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { getClip, listClips } from '../db/clips'
import { openDatabase } from '../db/connection'
import {
  addImageClip,
  addTextClip,
  clearExpiredClips,
  clipFilePath,
  clipToTask,
  createClipTrash,
  editClip,
  imageType,
  keepClip,
} from './clips'

const DAY = 86_400_000
const NOW = new Date(2026, 9, 1, 10).getTime()
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16])
const GIF = new TextEncoder().encode('GIF89a......')
const WEBP = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')

let db: DatabaseSync
let dir: string
beforeEach(() => {
  db = openDatabase(':memory:')
  dir = mkdtempSync(join(tmpdir(), 'perch-clips-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('addTextClip', () => {
  test('keeps the text with its tags; a lone address is a link', () => {
    expect(addTextClip(db, '  NativeImage 存成 PNG #perch\n第二行 ', NOW)).toMatchObject({
      kind: 'text',
      text: 'NativeImage 存成 PNG #perch\n第二行',
      tags: ['perch'],
      kept: false,
      createdAt: NOW,
      usedAt: NOW,
    })
    expect(addTextClip(db, 'https://github.com/EcoPasteHub/EcoPaste', NOW).kind).toBe('link')
  })

  test('refuses nothing to keep', () => {
    expect(() => addTextClip(db, '   ', NOW)).toThrow()
  })
})

describe('imageType', () => {
  test('reads the format from the first bytes, not a name', () => {
    expect([PNG, JPEG, GIF, WEBP].map(imageType)).toEqual(['png', 'jpeg', 'gif', 'webp'])
    expect(imageType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull()
  })
})

describe('addImageClip', () => {
  test('writes the image into a month folder and keeps its size', () => {
    const clip = addImageClip(db, dir, PNG, { width: 1280, height: 720 }, NOW)

    expect(clip).toMatchObject({ kind: 'image', text: '', width: 1280, height: 720, bytes: PNG.length })
    expect(clip.file).toBe(`2026-10/${clip.id}.png`)
    expect(existsSync(clipFilePath(dir, clip)!)).toBe(true)
  })

  test('refuses what is not a picture, or too big', () => {
    expect(() => addImageClip(db, dir, new TextEncoder().encode('hello'), null, NOW)).toThrow()
    expect(() => addImageClip(db, dir, new Uint8Array(21 * 1024 * 1024).fill(0x89), null, NOW)).toThrow()
    expect(listClips(db)).toEqual([])
  })

  test('a file name that points outside the folder is never served', () => {
    const clip = addImageClip(db, dir, PNG, null, NOW)
    expect(clipFilePath(dir, { ...clip, file: '../../secret.txt' })).toBeNull()
    expect(clipFilePath(dir, { ...clip, file: null })).toBeNull()
  })
})

describe('editing', () => {
  test('a caption brings tags; 保留 keeps it and counts as a use', () => {
    const clip = addImageClip(db, dir, PNG, null, NOW)

    expect(editClip(db, clip.id, '浮窗的參考圖 #perch', NOW + 1)).toMatchObject({ kind: 'image', tags: ['perch'], usedAt: NOW + 1 })
    expect(keepClip(db, clip.id, true, NOW + 2)).toMatchObject({ kept: true, usedAt: NOW + 2 })
  })

  test('a text clip becomes a task in 隨手記, titled by its first line', () => {
    const text = addTextClip(db, '跟房東確認管理費\n月底前轉帳', NOW)

    expect(clipToTask(db, text.id, NOW)).toMatchObject({ kind: 'idea', title: '跟房東確認管理費' })
    expect(() => clipToTask(db, addImageClip(db, dir, PNG, null, NOW).id, NOW)).toThrow()
  })
})

describe('createClipTrash', () => {
  test('deleting moves the picture aside; undo within a minute brings both back', () => {
    let clock = NOW
    const trash = createClipTrash(dir, () => clock)
    const clip = addImageClip(db, dir, PNG, null, NOW)
    const file = clipFilePath(dir, clip)!

    trash.remove(db, clip.id)
    expect(getClip(db, clip.id)).toBeNull()
    expect(existsSync(file)).toBe(false)

    expect(trash.restore(db, clip.id)).toBe(true)
    expect(getClip(db, clip.id)).toEqual(clip)
    expect(existsSync(file)).toBe(true)

    trash.remove(db, clip.id)
    clock += 61_000
    expect(trash.restore(db, clip.id)).toBe(false)
  })
})

describe('clearExpiredClips', () => {
  test('clears what was not used for the chosen days, never what is kept', () => {
    const old = addImageClip(db, dir, PNG, null, NOW - 31 * DAY)
    const recent = addTextClip(db, '最近才用過', NOW - 31 * DAY)
    editClip(db, recent.id, '最近才用過', NOW - DAY)
    const kept = addTextClip(db, '保留的', NOW - 90 * DAY)
    keepClip(db, kept.id, true, NOW - 90 * DAY)

    expect(clearExpiredClips(db, dir, NOW, 30)).toBe(1)
    expect(listClips(db).map((c) => c.id).sort()).toEqual([recent.id, kept.id].sort())
    expect(existsSync(clipFilePath(dir, old)!)).toBe(false)
    expect(clearExpiredClips(db, dir, NOW, null)).toBe(0)
  })

  test('pictures set aside more than eight days ago are deleted for good', () => {
    const aside = join(dir, '.deleted')
    mkdirSync(aside, { recursive: true })
    writeFileSync(join(aside, 'old.png'), 'x')
    writeFileSync(join(aside, 'new.png'), 'x')
    utimesSync(join(aside, 'old.png'), new Date(NOW - 9 * DAY), new Date(NOW - 9 * DAY))
    utimesSync(join(aside, 'new.png'), new Date(NOW - DAY), new Date(NOW - DAY))

    clearExpiredClips(db, dir, NOW, 30)

    expect(readdirSync(aside)).toEqual(['new.png'])
  })
})
