import { DatabaseSync } from 'node:sqlite'
import { migrate } from './migrations'

/** Opens (or creates) the task database and brings its schema up to date. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 3000')
  migrate(db)
  return db
}
