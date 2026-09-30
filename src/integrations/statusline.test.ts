import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { HookSetup } from './install'
import { readQuota, saveQuota } from './quota'
import { installStatusline, statuslineCommand, statuslineInfo, uninstallStatusline, wrappedFile } from './statusline'
import { runWrapped } from './statuslineRun'

let home: string
let setup: HookSetup
const settingsPath = (): string => join(home, '.claude', 'settings.json')
const settings = (): Record<string, unknown> => JSON.parse(readFileSync(settingsPath(), 'utf8'))
const writeSettings = (value: unknown): void => {
  mkdirSync(join(home, '.claude'), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(value))
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'perch-statusline-'))
  setup = { cliPath: 'C:\\Program Files\\Perch 應用\\perch-hook.js', inboxDir: join(home, 'inbox'), home }
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('Claude Code status line', () => {
  test('the command uses forward slashes and quotes, so Git Bash and PowerShell both run it', () => {
    const s = { ...setup, inboxDir: 'C:\\Users\\me\\Perch\\inbox' }
    expect(statuslineCommand(s, false)).toBe(
      'node "C:/Program Files/Perch 應用/perch-hook.js" statusline claude-code --inbox "C:/Users/me/Perch/inbox"',
    )
    expect(statuslineCommand(s, true)).toContain(' --wrap "C:/Users/me/Perch/inbox/quota/claude-code-statusline.json"')
  })

  test('without a status line of their own, ours is added and comes out again cleanly', () => {
    writeSettings({ model: 'opus', hooks: { Stop: [] } })
    expect(statuslineInfo(setup)).toEqual({ state: 'not-installed', other: null })

    installStatusline(setup)
    expect(statuslineInfo(setup)).toEqual({ state: 'installed', other: null })
    expect(settings()).toMatchObject({ model: 'opus', hooks: { Stop: [] }, statusLine: { type: 'command', command: statuslineCommand(setup, false) } })

    uninstallStatusline(home)
    expect(settings()).toEqual({ model: 'opus', hooks: { Stop: [] } })
  })

  test('with their own status line, ours wraps it and removing ours puts theirs back exactly', () => {
    const theirs = { type: 'command', command: 'ccstatusline', padding: 1 }
    writeSettings({ model: 'opus', statusLine: theirs })
    expect(statuslineInfo(setup)).toEqual({ state: 'taken', other: 'ccstatusline' })

    installStatusline(setup)
    expect(settings()['statusLine']).toEqual({ type: 'command', command: statuslineCommand(setup, true), padding: 1 })
    expect(JSON.parse(readFileSync(wrappedFile(setup), 'utf8'))).toEqual(theirs)
    expect(statuslineInfo(setup)).toEqual({ state: 'installed', other: 'ccstatusline' })

    uninstallStatusline(home)
    expect(settings()).toEqual({ model: 'opus', statusLine: theirs })
    expect(statuslineInfo(setup)).toEqual({ state: 'taken', other: 'ccstatusline' })
  })

  test('reinstalling for another copy of the app keeps wrapping their status line', () => {
    writeSettings({ statusLine: { type: 'command', command: 'ccstatusline' } })
    installStatusline({ ...setup, inboxDir: join(home, 'old-inbox') })
    expect(statuslineInfo(setup).state).toBe('outdated')
    installStatusline(setup)
    expect(statuslineInfo(setup)).toEqual({ state: 'installed', other: 'ccstatusline' })
    uninstallStatusline(home)
    expect(settings()['statusLine']).toEqual({ type: 'command', command: 'ccstatusline' })
  })

  test('if their saved status line went missing, removing ours changes nothing', () => {
    writeSettings({ statusLine: { type: 'command', command: 'ccstatusline' } })
    installStatusline(setup)
    rmSync(wrappedFile(setup))
    const before = settings()
    expect(() => uninstallStatusline(home)).toThrow(/missing/)
    expect(settings()).toEqual(before)
  })

  test('without Claude Code there is nothing to install into', () => {
    expect(statuslineInfo(setup)).toEqual({ state: 'no-agent', other: null })
  })
})

describe('running their status line', () => {
  test('gets the same input and its output comes back untouched', async () => {
    const echo = 'node -e "process.stdin.on(\'data\', (d) => process.stdout.write(\'[\' + d + \']\'))"'
    expect(await runWrapped(echo, '{"x":1}')).toBe('[{"x":1}]')
  })

  test('a command that fails gives an empty line', async () => {
    expect(await runWrapped('definitely-not-a-command-perch', '{}')).toBe('')
  })
})

describe('quota file', () => {
  const snap = (used: number, at: number) => ({
    v: 1 as const,
    agent: 'claude-code',
    at,
    windows: [{ key: 'five_hour' as const, usedPercent: used, resetsAt: 9e12 }],
  })

  test('is written when the numbers change or a minute has passed', () => {
    const inbox = join(home, 'inbox')
    expect(saveQuota(inbox, snap(20, 1_000))).toBe(true)
    expect(saveQuota(inbox, snap(20, 30_000))).toBe(false)
    expect(saveQuota(inbox, snap(25, 31_000))).toBe(true)
    expect(saveQuota(inbox, snap(25, 95_000))).toBe(true)
    expect(readQuota(inbox, 'claude-code')).toEqual(snap(25, 95_000))
  })

  test('reads as nothing when missing or damaged', () => {
    const inbox = join(home, 'inbox')
    expect(readQuota(inbox, 'claude-code')).toBeNull()
    mkdirSync(join(inbox, 'quota'), { recursive: true })
    writeFileSync(join(inbox, 'quota', 'claude-code.json'), '{not json')
    expect(readQuota(inbox, 'claude-code')).toBeNull()
  })
})
