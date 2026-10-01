import { dayKey, daysBetween } from './day'

/** 暫存: what the person pasted to keep for a while. */
export type ClipKind = 'text' | 'image' | 'link'

export interface Clip {
  readonly id: string
  readonly kind: ClipKind
  /** The text, the link, or an image's caption ('' when it has none). */
  readonly text: string
  /** Image clips: the file name inside the clips folder; null for text and links. */
  readonly file: string | null
  readonly width: number | null
  readonly height: number | null
  readonly bytes: number | null
  /** Tags written as #tag in the text or caption, in lower case and without the #. */
  readonly tags: readonly string[]
  /** 保留: never cleared on its own. */
  readonly kept: boolean
  readonly createdAt: number
  /** Last copied, opened or edited; clearing counts from here. */
  readonly usedAt: number
}

export interface ClipsPayload {
  /** Newest first. */
  readonly clips: readonly Clip[]
  /** Days unused before a clip that is not kept is cleared; null = never. */
  readonly retentionDays: number | null
}

export type ClipKindFilter = ClipKind | 'all'

export interface ClipFilter {
  readonly kind: ClipKindFilter
  readonly tag: string | null
  readonly query: string
}

/** Pictures are shown through this scheme, by clip id: `perch-clip://image/<id>`. */
export const CLIP_SCHEME = 'perch-clip'
export const clipImageUrl = (id: string): string => `${CLIP_SCHEME}://image/${id}`

export const RETENTION_CHOICES: readonly (number | null)[] = [7, 30, 90, null]
export const DEFAULT_RETENTION_DAYS = 30
/** In its last days a clip that is not kept says when it goes. */
export const WARN_DAYS = 3
/** Longer than any note worth keeping here; a whole log file belongs in a file. */
export const MAX_CLIP_TEXT = 200_000

const DAY_MS = 86_400_000
const TAG = /#([\p{L}\p{N}_\-/]+)/gu
const LINK = /^https?:\/\/\S+$/i

export function tagsOf(text: string): string[] {
  const tags = [...text.matchAll(TAG)].map((m) => m[1].toLowerCase())
  return [...new Set(tags)]
}

export const kindOfText = (text: string): ClipKind => (LINK.test(text.trim()) ? 'link' : 'text')

/** When a clip that is not kept is cleared; null when it is kept or nothing is ever cleared. */
export function clearsAt(clip: Clip, retentionDays: number | null): number | null {
  if (clip.kept || retentionDays === null) return null
  return clip.usedAt + retentionDays * DAY_MS
}

export function isExpired(clip: Clip, now: number, retentionDays: number | null): boolean {
  const end = clearsAt(clip, retentionDays)
  return end !== null && end <= now
}

/** Whole days left, but only in the last few; null the rest of the time. */
export function daysLeft(clip: Clip, now: number, retentionDays: number | null): number | null {
  const end = clearsAt(clip, retentionDays)
  if (end === null) return null
  const days = Math.max(1, Math.ceil((end - now) / DAY_MS))
  return days <= WARN_DAYS ? days : null
}

export interface ClipGroup {
  readonly key: 'kept' | 'today' | 'yesterday' | 'earlier'
  readonly label: string
  readonly clips: readonly Clip[]
}

const GROUP_LABEL: Readonly<Record<ClipGroup['key'], string>> = { kept: '保留', today: '今天', yesterday: '昨天', earlier: '更早' }

/** 保留 first, then today, yesterday and earlier by the app's days; newest first in each, empty groups left out. */
export function groupClips(clips: readonly Clip[], now: number, dayStartHour: number): ClipGroup[] {
  const today = dayKey(now, dayStartHour)
  const keyOf = (c: Clip): ClipGroup['key'] => {
    if (c.kept) return 'kept'
    const days = daysBetween(dayKey(c.createdAt, dayStartHour), today)
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : 'earlier'
  }
  const sorted = [...clips].sort((a, b) => b.createdAt - a.createdAt)
  return (['kept', 'today', 'yesterday', 'earlier'] as const)
    .map((key) => ({ key, label: GROUP_LABEL[key], clips: sorted.filter((c) => keyOf(c) === key) }))
    .filter((g) => g.clips.length > 0)
}

export function matchesFilter(clip: Clip, filter: ClipFilter): boolean {
  if (filter.kind !== 'all' && clip.kind !== filter.kind) return false
  if (filter.tag !== null && !clip.tags.includes(filter.tag)) return false
  const query = filter.query.trim().toLowerCase()
  return !query || clip.text.toLowerCase().includes(query)
}

/** The tags used most, for the filter chips. */
export function topTags(clips: readonly Clip[], limit: number): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const c of clips) for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit)
}
