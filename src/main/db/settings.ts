import type { DatabaseSync } from 'node:sqlite'

export function getSetting<T>(db: DatabaseSync, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row ? (JSON.parse(row.value) as T) : fallback
}

export function setSetting(db: DatabaseSync, key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value))
}
