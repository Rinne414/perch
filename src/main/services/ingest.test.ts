import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { writeInboxEvent } from '../../integrations/inbox'
import { listAgentSessions } from '../db/agents'
import { openDatabase } from '../db/connection'
import { ingestInbox } from './ingest'

describe('ingestInbox', () => {
  test('applies valid events in order, sets bad files aside, and empties the inbox', () => {
    const db = openDatabase(':memory:')
    const dir = mkdtempSync(join(tmpdir(), 'tc-ingest-'))
    writeInboxEvent(dir, { v: 1, agent: 'codex', sessionId: 's', status: 'running', at: 1 })
    writeInboxEvent(dir, { v: 1, agent: 'codex', sessionId: 's', status: 'done', at: 2 })
    writeFileSync(join(dir, '0-garbage.json'), '{"v":1,"agent":"codex"}')

    expect(ingestInbox(db, dir, 10)).toEqual({ applied: 2, rejected: 1 })
    expect(listAgentSessions(db, 0).map((s) => [s.id, s.status])).toEqual([['codex:s', 'done']])
    expect(readdirSync(dir).filter((n) => n.endsWith('.json'))).toEqual([])
    expect(readdirSync(join(dir, 'rejected'))).toEqual(['0-garbage.json'])
  })

  test('accepts a file saved with a byte order mark, as Windows PowerShell writes UTF-8', () => {
    const db = openDatabase(':memory:')
    const dir = mkdtempSync(join(tmpdir(), 'tc-ingest-'))
    const event = { v: 1, agent: 'my-script', sessionId: 'b', status: 'done', at: 1 }
    writeFileSync(join(dir, '1-bom.json'), `﻿${JSON.stringify(event)}`)

    expect(ingestInbox(db, dir, 10)).toEqual({ applied: 1, rejected: 0 })
  })
})
