import type { DatabaseSync } from 'node:sqlite'
import { kindOfText, tagsOf, type Clip, type ClipKind } from '@shared/clips'

interface ClipRow {
  id: string
  kind: string
  text: string
  file: string | null
  width: number | null
  height: number | null
  bytes: number | null
  tags: string
  kept: number
  created_at: number
  used_at: number
}

const toClip = (r: ClipRow): Clip => ({
  id: r.id,
  kind: r.kind as ClipKind,
  text: r.text,
  file: r.file,
  width: r.width,
  height: r.height,
  bytes: r.bytes,
  tags: JSON.parse(r.tags) as string[],
  kept: r.kept === 1,
  createdAt: r.created_at,
  usedAt: r.used_at,
})

export function insertClip(db: DatabaseSync, c: Clip): void {
  db.prepare(
    `INSERT INTO clips (id, kind, text, file, width, height, bytes, tags, kept, created_at, used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(c.id, c.kind, c.text, c.file, c.width, c.height, c.bytes, JSON.stringify(c.tags), c.kept ? 1 : 0, c.createdAt, c.usedAt)
}

export function getClip(db: DatabaseSync, id: string): Clip | null {
  const row = db.prepare('SELECT * FROM clips WHERE id = ?').get(id) as ClipRow | undefined
  return row ? toClip(row) : null
}

function requireClip(db: DatabaseSync, id: string): Clip {
  const clip = getClip(db, id)
  if (!clip) throw new Error(`Clip not found: ${id}`)
  return clip
}

/** Newest first. */
export function listClips(db: DatabaseSync): Clip[] {
  return (db.prepare('SELECT * FROM clips ORDER BY created_at DESC').all() as unknown as ClipRow[]).map(toClip)
}

/** New text or caption; a text clip becomes a link (or back) when its words say so. Counts as a use. */
export function updateClipText(db: DatabaseSync, id: string, text: string, now: number): Clip {
  const clip = requireClip(db, id)
  const kind = clip.kind === 'image' ? 'image' : kindOfText(text)
  db.prepare('UPDATE clips SET text = ?, kind = ?, tags = ?, used_at = ? WHERE id = ?').run(
    text,
    kind,
    JSON.stringify(tagsOf(text)),
    now,
    id,
  )
  return requireClip(db, id)
}

export function setClipKept(db: DatabaseSync, id: string, kept: boolean, now: number): Clip {
  requireClip(db, id)
  db.prepare('UPDATE clips SET kept = ?, used_at = ? WHERE id = ?').run(kept ? 1 : 0, now, id)
  return requireClip(db, id)
}

/** Copying or opening a clip keeps it from being cleared for another while. */
export function touchClip(db: DatabaseSync, id: string, now: number): void {
  db.prepare('UPDATE clips SET used_at = ? WHERE id = ?').run(now, id)
}

export function deleteClip(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM clips WHERE id = ?').run(id)
}

/** Clips that are not kept and were last used at or before `before`. */
export function listUnusedSince(db: DatabaseSync, before: number): Clip[] {
  return (db.prepare('SELECT * FROM clips WHERE kept = 0 AND used_at <= ?').all(before) as unknown as ClipRow[]).map(toClip)
}
