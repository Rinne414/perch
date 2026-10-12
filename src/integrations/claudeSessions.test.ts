import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeSessionName, findTranscripts, liveSessionIds, readClaudeRegistry, transcriptName } from './claudeSessions'

const line = (o: unknown): string => JSON.stringify(o)

describe('transcriptName', () => {
  test("Claude Code's latest title", () => {
    const text = [
      line({ type: 'user', message: { content: 'hi' } }),
      line({ type: 'ai-title', aiTitle: '先取的名字', sessionId: 'x' }),
      line({ type: 'ai-title', aiTitle: 'Perch Round 10 重開機 session 清單', sessionId: 'x' }),
    ].join('\n')
    expect(transcriptName(text)).toBe('Perch Round 10 重開機 session 清單')
  })

  test('a name the person gave with /rename wins', () => {
    const text = [line({ type: 'custom-title', customTitle: '我的名字' }), line({ type: 'ai-title', aiTitle: '後來的自動名字' })].join('\n')
    expect(transcriptName(text)).toBe('我的名字')
  })

  test('messages that only mention the words, and cut lines, are not titles', () => {
    const text = [
      line({ type: 'assistant', message: { content: 'read "aiTitle":"fake" from the file' } }),
      '{"type":"ai-title","aiTitle":"cut in ha',
    ].join('\n')
    expect(transcriptName(text)).toBeNull()
  })
})

describe('files', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'perch-claude-'))
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  test('a transcript is found by its session id in any project folder, and read for its name', () => {
    const dir = join(home, '.claude', 'projects', 'L--code-app')
    mkdirSync(dir, { recursive: true })
    const id = '8a00044b-0000-4000-8000-000000000000'
    writeFileSync(join(dir, `${id}.jsonl`), `${line({ type: 'ai-title', aiTitle: '登入頁' })}\n`)

    const found = findTranscripts(home, [id, '../escape', 'missing'])

    expect([...found.keys()]).toEqual([id])
    expect(claudeSessionName(found.get(id))).toBe('登入頁')
    expect(claudeSessionName(join(dir, 'nope.jsonl'))).toBeNull()
    expect(claudeSessionName(undefined)).toBeNull()
  })

  test("the registry of running sessions: interactive ones only, NUL padding after a crash tolerated", () => {
    const dir = join(home, '.claude', 'sessions')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '100.json'), line({ pid: 100, sessionId: 'a', procStart: '111', kind: 'interactive' }) + '\0\0\0')
    writeFileSync(join(dir, '200.json'), line({ pid: 200, sessionId: 'b', procStart: '222', kind: 'sdk' }))
    writeFileSync(join(dir, '300.json'), '{broken')
    writeFileSync(join(dir, 'compaction-log.txt'), 'x')

    expect(readClaudeRegistry(home)).toEqual([{ pid: 100, sessionId: 'a', procStart: '111' }])
    expect(readClaudeRegistry(join(home, 'nobody'))).toBeNull()
  })
})

describe('liveSessionIds', () => {
  test('alive under the same PID and the same start time; a reused PID does not count', () => {
    const entries = [
      { pid: 1, sessionId: 'alive', procStart: '10' },
      { pid: 2, sessionId: 'reused', procStart: '20' },
      { pid: 3, sessionId: 'dead', procStart: '30' },
    ]
    expect([...liveSessionIds(entries, new Map([[1, '10'], [2, '99']]))]).toEqual(['alive'])
  })

  test("Claude Code's procStart is the FILETIME PowerShell prints for the same process (checked on 2.1.296)", () => {
    // A real registry file and Get-Process for the same process printed the same FILETIME.
    const entries = [{ pid: 4242, sessionId: 'abc12345', procStart: '134362340055439369' }]
    expect([...liveSessionIds(entries, new Map([[4242, '134362340055439369']]))]).toEqual(['abc12345'])
  })
})
