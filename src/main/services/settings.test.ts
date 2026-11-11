import { beforeEach, describe, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../db/connection'
import { setSetting } from '../db/settings'
import { readSettings, settleAutoReports, updateSettings } from './settings'

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('settleAutoReports', () => {
  test('a new setup gets session notes by itself once it chooses an Obsidian folder', () => {
    settleAutoReports(db)
    expect(readSettings(db).autoReports).toBe(true)
  })

  test('an Obsidian folder chosen before this version is not filled with prompts and replies unasked', () => {
    setSetting(db, 'app', { obsidianDir: 'D:\vault' })

    settleAutoReports(db)

    expect(readSettings(db).autoReports).toBe(false)
  })

  test('the decision is written once and never flips later', () => {
    setSetting(db, 'app', { obsidianDir: 'D:\vault' })
    settleAutoReports(db)
    updateSettings(db, { obsidianDir: null })
    settleAutoReports(db)
    expect(readSettings(db).autoReports).toBe(false)

    updateSettings(db, { autoReports: true })
    settleAutoReports(db)
    expect(readSettings(db).autoReports).toBe(true)
  })
})
