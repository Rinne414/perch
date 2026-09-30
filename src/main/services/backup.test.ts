import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openDatabase } from '../db/connection'
import { createItem } from '../db/items'
import { backupIfDue, backupName, BACKUPS_KEPT, listBackups, writeBackup } from './backup'

const at = (d: number, h: number, min = 0, s = 0): Date => new Date(2026, 8, d, h, min, s)

let dir: string
let db: DatabaseSync
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'perch-backup-'))
  db = openDatabase(join(dir, 'tasks.db'))
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const backups = (): string => join(dir, 'backups')

describe('backups', () => {
  test('names sort by time and say which ones came before an update', () => {
    expect(backupName('daily', at(30, 9, 5, 2))).toBe('tasks-2026-09-30_09-05-02.db')
    expect(backupName('before-update', at(30, 9, 5, 2))).toBe('tasks-2026-09-30_09-05-02-before-update.db')
  })

  test('a copy opens on its own and holds the same data', () => {
    createItem(db, { kind: 'task', title: '交報告' }, at(29, 10).getTime())
    const path = writeBackup(db, backups(), 'daily', at(30, 9))
    const copy = new DatabaseSync(path)
    const rows = copy.prepare('SELECT title FROM items').all()
    copy.close()
    expect(rows).toEqual([{ title: '交報告' }])
  })

  test('keeps only the newest copies of each kind and leaves other files alone', () => {
    const kept = BACKUPS_KEPT.daily
    for (let d = 1; d <= kept + 3; d++) writeBackup(db, backups(), 'daily', at(d, 9))
    writeBackup(db, backups(), 'before-update', at(2, 8))
    writeFileSync(join(backups(), 'notes.txt'), 'mine')
    writeBackup(db, backups(), 'daily', at(20, 9))

    const daily = listBackups(backups()).filter((b) => b.kind === 'daily')
    expect(daily).toHaveLength(kept)
    expect(daily[0].name).toBe('tasks-2026-09-20_09-00-00.db')
    expect(listBackups(backups()).some((b) => b.kind === 'before-update')).toBe(true)
    expect(readdirSync(backups())).toContain('notes.txt')
  })

  test('takes one daily copy per calendar date', () => {
    expect(backupIfDue(db, backups(), at(30, 9))).not.toBeNull()
    expect(backupIfDue(db, backups(), at(30, 23, 59))).toBeNull()
    expect(backupIfDue(db, backups(), at(31, 0, 1))).not.toBeNull()
  })

  test('a copy taken before an update does not count as the daily one', () => {
    writeBackup(db, backups(), 'before-update', at(30, 9))
    expect(backupIfDue(db, backups(), at(30, 9, 1))).not.toBeNull()
  })
})

describe('opening a database', () => {
  test('runs the upgrade hook only for an existing database that is about to change', () => {
    const calls: string[] = []
    // A database from the version before the last migration.
    const path = join(dir, 'old.db')
    const old = openDatabase(path)
    old.exec('DROP TABLE day_notes')
    old.exec('PRAGMA user_version = 3')
    old.close()

    openDatabase(join(dir, 'fresh.db'), () => calls.push('fresh')).close()
    const upgraded = openDatabase(path, () => calls.push('old'))
    upgraded.close()
    openDatabase(path, () => calls.push('again')).close()

    expect(calls).toEqual(['old'])
  })
})
