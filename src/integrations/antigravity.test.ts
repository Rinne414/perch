import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { hookPayloadToEvent } from './adapters'
import {
  antigravityHook,
  antigravityHooksFile,
  antigravityProduct,
  antigravityState,
  installAntigravity,
  lastReply,
  lastUserRequest,
  readTranscriptTail,
  uninstallAntigravity,
  wrapperScript,
} from './antigravity'
import type { HookSetup } from './configFile'

const NOW = 1_700_000_000_000

/** The shape of real `agy` 1.1.28 payloads (captured 2026-10-08), with the event added by the CLI. */
const base = {
  artifactDirectoryPath: 'C:/Users/me/.gemini/antigravity-cli/brain/0b1c2d3e',
  conversationId: '0b1c2d3e-4f50-4617-8a9b-c0d1e2f3a4b5',
  modelName: 'gemini-3.8-flash-high',
  transcriptPath: 'C:/Users/me/.gemini/antigravity-cli/brain/0b1c2d3e/.system_generated/logs/transcript_full.jsonl',
  workspacePaths: ['C:/Users/me/code/perch'],
}

const map = (payload: Record<string, unknown>): ReturnType<typeof hookPayloadToEvent> => hookPayloadToEvent('antigravity', payload, NOW)

function setup(): HookSetup {
  const home = mkdtempSync(join(tmpdir(), 'perch-agy-'))
  mkdirSync(join(home, '.gemini', 'config'), { recursive: true })
  return { home, cliPath: 'L:\\My App\\out\\main\\perch-hook.js', inboxDir: 'L:\\My App\\.data\\inbox' }
}

const orca = {
  'orca-status': { Stop: [{ type: 'command', command: 'C:\\Users\\me\\.orca\\agent-hooks\\antigravity-stop.cmd', timeout: 10 }] },
}

describe('antigravity events', () => {
  test('a turn starts running, named after the prompt, in the folder Antigravity reports', () => {
    expect(map({ ...base, hook_event_name: 'PreInvocation', invocationNum: 0, initialNumSteps: 1, prompt: '修好登入頁\n細節…' })).toEqual({
      v: 1,
      agent: 'antigravity-cli',
      sessionId: '0b1c2d3e-4f50-4617-8a9b-c0d1e2f3a4b5',
      status: 'running',
      at: NOW,
      cwd: 'C:\\Users\\me\\code\\perch',
      title: '修好登入頁',
    })
  })

  test('later model calls and tool steps keep it running without renaming it', () => {
    expect(map({ ...base, hook_event_name: 'PreInvocation', invocationNum: 1 })).not.toHaveProperty('title')
    expect(map({ ...base, hook_event_name: 'PostToolUse', stepIdx: 2, toolCall: { name: 'view_file' } })).toMatchObject({ status: 'running' })
  })

  test('Stop: finished, failed, out of steps, cancelled, or still busy in the background', () => {
    const stop = { ...base, hook_event_name: 'Stop', executionNum: 0, error: '', fullyIdle: true }
    expect(map({ ...stop, terminationReason: 'NO_TOOL_CALL', last_reply: 'DONE' })).toMatchObject({ status: 'done', detail: 'DONE' })
    const linked = '[capture.cjs](file:///C:/Users/me/x/capture.cjs) saves each payload.\nMore.'
    expect(map({ ...stop, terminationReason: 'NO_TOOL_CALL', last_reply: linked })).toMatchObject({ detail: 'capture.cjs saves each payload.' })
    expect(map({ ...stop, terminationReason: 'ERROR', error: 'quota exceeded\nmore' })).toMatchObject({ status: 'failed', detail: 'quota exceeded' })
    expect(map({ ...stop, terminationReason: 'MAX_STEPS_EXCEEDED' })).toMatchObject({ status: 'failed', detail: '步數用完了' })
    expect(map({ ...stop, terminationReason: 'CANCELLED' })).toMatchObject({ status: 'cancelled' })
    expect(map({ ...stop, terminationReason: 'NO_TOOL_CALL', fullyIdle: false })).toMatchObject({ status: 'running' })
  })

  test('the IDE and Antigravity 2.0 are told apart by their transcript folder', () => {
    const ide = { ...base, transcriptPath: 'C:/Users/me/.gemini/antigravity-ide/brain/x/transcript.jsonl' }
    expect(map({ ...ide, hook_event_name: 'PostToolUse' })).toMatchObject({ agent: 'antigravity-ide' })
    expect(antigravityProduct('C:\\Users\\me\\.gemini\\antigravity\\brain\\x\\t.jsonl')).toBe('antigravity')
    expect(antigravityProduct(undefined)).toBe('antigravity')
  })

  test('no conversation id or an unknown event is not reported', () => {
    expect(map({ ...base, conversationId: undefined, hook_event_name: 'Stop' })).toBeNull()
    expect(map({ ...base, hook_event_name: 'PostInvocation' })).toBeNull()
  })
})

describe('antigravity transcript', () => {
  const lines = [
    JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: '<USER_REQUEST>\n整理測試圖\n</USER_REQUEST>\n<ADDITIONAL_METADATA>…</ADDITIONAL_METADATA>' }),
    JSON.stringify({ step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', content: '' }),
    JSON.stringify({ step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', content: '整理好了，放在 out/' }),
    'not json',
  ]

  test('the last request and the last non-empty answer are found', () => {
    expect(lastUserRequest(lines)).toBe('整理測試圖')
    expect(lastReply(lines)).toBe('整理好了，放在 out/')
    expect(lastUserRequest([])).toBeUndefined()
  })

  test('only the end of a long transcript is read, and a cut first line is dropped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perch-tr-'))
    const file = join(dir, 'transcript_full.jsonl')
    const filler = JSON.stringify({ type: 'PLANNER_RESPONSE', content: 'x'.repeat(1000) })
    writeFileSync(file, [...Array<string>(400).fill(filler), ...lines].join('\n'))
    const tail = readTranscriptTail(file)
    expect(tail.length).toBeLessThan(404)
    expect(() => tail.forEach((l) => l !== 'not json' && JSON.parse(l))).not.toThrow()
    expect(lastReply(tail)).toBe('整理好了，放在 out/')
    expect(readTranscriptTail(join(dir, 'missing.jsonl'))).toEqual([])
    expect(readTranscriptTail(join(dir, 'notes.txt'))).toEqual([])
  })
})

describe('antigravity install', () => {
  test('Windows: a relative script name in hooks.json, the quoted paths in the script next to it', () => {
    const s = setup()
    const hook = antigravityHook(s, true)
    expect(JSON.stringify(hook)).not.toContain('"node')
    expect(hook['Stop']).toEqual([{ type: 'command', command: '.\\perch-hook.cmd Stop', timeout: 10 }])
    expect(hook['PostToolUse']).toEqual([{ matcher: '*', hooks: [{ type: 'command', command: '.\\perch-hook.cmd PostToolUse', timeout: 10 }] }])
    expect(wrapperScript(s)).toContain('node "L:\\My App\\out\\main\\perch-hook.js" hook antigravity --event %1 --inbox "L:\\My App\\.data\\inbox"')
    expect(wrapperScript(s)).not.toContain('chcp')
    expect(wrapperScript({ ...s, inboxDir: 'C:\\Users\\林\\inbox' })).toContain('chcp 65001')
  })

  test('elsewhere: one shell command with single-quoted paths', () => {
    const s = { ...setup(), cliPath: "/home/o'neil/perch-hook.js", inboxDir: '/home/me/inbox' }
    expect(antigravityHook(s, false)['Stop']).toEqual([
      { type: 'command', command: "node '/home/o'\\''neil/perch-hook.js' hook antigravity --event Stop --inbox '/home/me/inbox'", timeout: 10 },
    ])
  })

  test('install adds our named hook next to others, once, and uninstall takes back only ours', () => {
    const s = setup()
    const file = antigravityHooksFile(s.home)
    writeFileSync(file, JSON.stringify(orca, null, 2))
    expect(antigravityState(s, true)).toBe('not-installed')

    installAntigravity(s, true)
    installAntigravity(s, true)
    const config = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(Object.keys(config)).toEqual(['orca-status', 'perch'])
    expect(config['orca-status']).toEqual(orca['orca-status'])
    expect(antigravityState(s, true)).toBe('installed')
    expect(readFileSync(join(s.home, '.gemini', 'config', 'perch-hook.cmd'), 'utf8')).toBe(wrapperScript(s))

    expect(uninstallAntigravity(s.home)).toBe(file)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(orca)
    expect(uninstallAntigravity(s.home)).toBeNull()
    expect(antigravityState(s, true)).toBe('not-installed')
  })

  test('a hook pointing at another copy of the app is outdated', () => {
    const s = setup()
    installAntigravity({ ...s, cliPath: 'C:\\old\\perch-hook.js' }, true)
    expect(antigravityState(s, true)).toBe('outdated')
  })

  test('without Antigravity on the computer there is nothing to install into', () => {
    const home = mkdtempSync(join(tmpdir(), 'perch-none-'))
    expect(antigravityState({ home, cliPath: 'x', inboxDir: 'y' }, true)).toBe('no-agent')
  })
})
