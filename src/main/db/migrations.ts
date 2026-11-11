import type { DatabaseSync } from 'node:sqlite'

/**
 * Append-only list. Each entry runs once, in order, tracked by PRAGMA user_version.
 * Never edit a shipped migration; add a new one instead.
 */
/** SQL to run, or code for a step SQL alone cannot do (one that has to be safe to run twice). */
type Migration = string | ((db: DatabaseSync) => void)

const MIGRATIONS: readonly Migration[] = [
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
  // A note per day (the diary in the calendar), keyed by the app's day (YYYY-MM-DD).
  `
  CREATE TABLE day_notes (
    day TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // The project (the folder agents work in) a task or idea belongs to, when it has one.
  `
  ALTER TABLE items ADD COLUMN project TEXT;
  CREATE INDEX items_project ON items (project) WHERE project IS NOT NULL;
  `,
  // 暫存: pasted text, links and images. Image bytes live in files under <data>/clips; tags are JSON.
  `
  CREATE TABLE clips (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'link')),
    text TEXT NOT NULL DEFAULT '',
    file TEXT,
    width INTEGER,
    height INTEGER,
    bytes INTEGER,
    tags TEXT NOT NULL DEFAULT '[]',
    kept INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    used_at INTEGER NOT NULL
  );
  CREATE INDEX clips_used ON clips (kept, used_at);
  `,
  // When a session was closed (or found closed after a restart), and when Perch reopened it in a terminal.
  // Sessions from before this version count as closed, so old history is never offered for reopening.
  `
  ALTER TABLE agent_sessions ADD COLUMN ended_at INTEGER;
  ALTER TABLE agent_sessions ADD COLUMN reopened_at INTEGER;
  UPDATE agent_sessions SET ended_at = updated_at;
  `,
  // What a session is called: the agent's own name for it, else its first prompt.
  `
  ALTER TABLE agent_sessions ADD COLUMN name TEXT;
  `,
  // Routines due on fixed days of every month: JSON {"days":[5],"leadDays":0}.
  // Agent replies keep their folder themselves from now on; older ones get it from their session,
  // so the calendar can still open the folder after a session is taken off the list.
  `
  ALTER TABLE items ADD COLUMN monthly TEXT;
  UPDATE events
     SET data = json_set(data, '$.cwd', (SELECT s.cwd FROM agent_sessions s WHERE s.id = events.agent_session_id))
   WHERE type = 'agent.status'
     AND CASE WHEN json_valid(data) THEN json_extract(data, '$.cwd') IS NULL ELSE 0 END
     AND (SELECT s.cwd FROM agent_sessions s WHERE s.id = events.agent_session_id) IS NOT NULL;
  `,
  // What each turn of an agent session asked and answered, whole. prompt is null when nobody typed
  // one (the session began before this table, or the turn was a background notice); reply and
  // ended_at stay null until the agent stops. IF NOT EXISTS: the older migration tests build their
  // "old" databases from the current schema and replay everything after the version they set.
  `
  CREATE TABLE IF NOT EXISTS agent_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    prompt TEXT,
    ended_at INTEGER,
    reply TEXT
  );
  CREATE INDEX IF NOT EXISTS agent_turns_session ON agent_turns (agent_session_id, started_at);
  CREATE INDEX IF NOT EXISTS agent_turns_ended ON agent_turns (ended_at);
  `,
  // 11
  // Points of a session's report the person ticked off in 報告裡留給你的事. key is a hash of the
  // report's time and the point's text (shared/todos.ts todoKey), so the same report read again keeps
  // its ticks and a later report starts fresh; the marks go with the session.
  `
  CREATE TABLE IF NOT EXISTS agent_todo_marks (
    agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    marked_at INTEGER NOT NULL,
    PRIMARY KEY (agent_session_id, key)
  );
  `,
  // 12
  addReplyLength,
]

/**
 * Migration 12: agent_turns.reply_len, the length of the trimmed reply (0 for none or blank), so the
 * report pick compares lengths without reading any reply; a covering index the pick reads from; and
 * one the time track reads from, so neither walks past a long prompt or reply to reach a time.
 * The backfill trims in JavaScript, as recordTurn does. Safe to run on a table that has the column
 * (the older migration tests build their "old" databases from the current schema).
 */
function addReplyLength(db: DatabaseSync): void {
  const columns = (db.prepare('PRAGMA table_info(agent_turns)').all() as { name: string }[]).map((c) => c.name)
  if (!columns.includes('reply_len')) db.exec('ALTER TABLE agent_turns ADD COLUMN reply_len INTEGER NOT NULL DEFAULT 0')
  const update = db.prepare('UPDATE agent_turns SET reply_len = ? WHERE id = ?')
  // A page at a time, each read finished before its updates, so no update runs under an open read.
  const page = db.prepare('SELECT id, reply FROM agent_turns WHERE reply IS NOT NULL AND id > ? ORDER BY id LIMIT 200')
  for (let after = 0; ; ) {
    const rows = page.all(after) as unknown as { id: number; reply: string }[]
    if (rows.length === 0) break
    for (const r of rows) update.run(r.reply.trim().length, r.id)
    after = Number(rows[rows.length - 1].id)
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS agent_turns_shape ON agent_turns
       (agent_session_id, started_at, id, reply_len, ended_at, prompt IS NOT NULL, reply IS NOT NULL);
     CREATE INDEX IF NOT EXISTS agent_turns_span ON agent_turns (ended_at, started_at, agent_session_id)`,
  )
}

const userVersion = (db: DatabaseSync): number =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version

/** True when a database that already holds data is about to be changed by a migration. */
export function needsUpgrade(db: DatabaseSync): boolean {
  const v = userVersion(db)
  return v > 0 && v < MIGRATIONS.length
}

export function migrate(db: DatabaseSync): void {
  for (let v = userVersion(db); v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      const step = MIGRATIONS[v]
      if (typeof step === 'string') db.exec(step)
      else step(db)
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(`Database migration ${v + 1} failed: ${(err as Error).message}`)
    }
  }
}
