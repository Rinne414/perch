import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { readInbox, rejectInboxFile, removeInboxFile, writeInboxEvent } from './inbox'

const event = { v: 1 as const, agent: 'codex', sessionId: 's', status: 'done' as const }

describe('inbox', () => {
  test('written events are read back whole, and half-written files are skipped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-inbox-'))
    writeInboxEvent(dir, event)
    writeFileSync(join(dir, '999-abc.json.tmp'), '{"v":1')

    const files = readInbox(dir)

    expect(files).toHaveLength(1)
    expect(JSON.parse(files[0].content)).toEqual(event)
    removeInboxFile(files[0].path)
    expect(readInbox(dir)).toHaveLength(0)
  })

  test('a missing folder reads as empty; rejected files move aside', () => {
    expect(readInbox(join(tmpdir(), 'tc-does-not-exist'))).toEqual([])

    const dir = mkdtempSync(join(tmpdir(), 'tc-inbox-'))
    writeFileSync(join(dir, '1-bad.json'), 'not json')
    rejectInboxFile(dir, join(dir, '1-bad.json'))

    expect(readdirSync(join(dir, 'rejected'))).toEqual(['1-bad.json'])
    expect(readInbox(dir)).toEqual([])
  })
})
