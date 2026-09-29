import type { DatabaseSync } from 'node:sqlite'
import type { Priority } from '@shared/types'
import { completeItem, createItem } from './items'
import { getSetting, setSetting } from './settings'
import { transaction } from './transaction'

interface LegacyItem {
  id?: unknown
  text?: unknown
  p?: unknown
  done?: unknown
}

const IMPORTED_FLAG = 'legacyImported'

const isPriority = (p: unknown): p is Priority => p === 0 || p === 1 || p === 2

/**
 * Imports the original float's data.json once. The three tutorial rows it ships
 * with (ids starting with "welcome") are skipped. Returns how many items were added.
 */
export function importLegacyData(db: DatabaseSync, json: string, now: number): number {
  if (getSetting(db, IMPORTED_FLAG, false)) return 0
  const parsed = JSON.parse(json) as { items?: unknown }
  const rows = Array.isArray(parsed.items) ? (parsed.items as LegacyItem[]) : []
  return transaction(db, () => {
    let count = 0
    for (const row of rows) {
      if (typeof row.text !== 'string' || !row.text.trim()) continue
      if (typeof row.id === 'string' && row.id.startsWith('welcome')) continue
      const item = createItem(
        db,
        {
          kind: 'task',
          title: row.text,
          priority: isPriority(row.p) ? row.p : null,
          source: 'import:legacy',
        },
        now,
      )
      if (row.done === true) completeItem(db, item.id, now)
      count++
    }
    setSetting(db, IMPORTED_FLAG, true)
    return count
  })
}
