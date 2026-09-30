import type { DatabaseSync } from 'node:sqlite'

/**
 * Append-only list. Each entry runs once, in order, tracked by PRAGMA user_version.
 * Never edit a shipped migration; add a new one instead.
 */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('task', 'idea', 'routine')),
    title TEXT NOT NULL,
    notes TEXT,
    parent_id TEXT REFERENCES items(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    priority INTEGER CHECK (priority IN (0, 1, 2)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    due_at INTEGER,
    due_has_time INTEGER NOT NULL DEFAULT 0,
    planned_for TEXT,
    done_at INTEGER,
    postpone_count INTEGER NOT NULL DEFAULT 0,
    interval_days INTEGER,
    last_done_at INTEGER,
    notified_at INTEGER,
    source TEXT NOT NULL DEFAULT 'user'
  );
  CREATE INDEX items_open ON items (kind, done_at);
  CREATE INDEX items_parent ON items (parent_id);

  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    item_id TEXT,
    agent_session_id TEXT,
    source TEXT NOT NULL,
    data TEXT
  );
  CREATE INDEX events_at ON events (at);

  CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    session_id TEXT NOT NULL,
    cwd TEXT,
    title TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'needs_input', 'done', 'failed', 'cancelled')),
    detail TEXT,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    attention_at INTEGER,
    acknowledged_at INTEGER
  );
  CREATE INDEX agent_sessions_updated ON agent_sessions (updated_at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // "不做了": closed without being done. done_at is set as well, so every "still open" query stays as it is.
  `
  ALTER TABLE items ADD COLUMN dropped_at INTEGER;
  `,
  // Fixed weekly times of a routine, as JSON (RoutineSchedule).
  `
  ALTER TABLE items ADD COLUMN schedule TEXT;
  `,
]

export function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(`Database migration ${v + 1} failed: ${(err as Error).message}`)
    }
  }
}
