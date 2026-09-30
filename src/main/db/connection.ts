import { DatabaseSync } from 'node:sqlite'
import { migrate, needsUpgrade } from './migrations'

/**
 * Opens (or creates) the task database and brings its schema up to date.
 * `beforeUpgrade` runs first when a database that already holds data is about to change shape.
 */
export function openDatabase(path: string, beforeUpgrade?: (db: DatabaseSync) => void): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 3000')
  if (beforeUpgrade && needsUpgrade(db)) beforeUpgrade(db)
  migrate(db)
  return db
}
