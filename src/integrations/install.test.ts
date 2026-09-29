import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  install,
  installState,
  isInstalled,
  MARKER,
  uninstall,
  withOurHooks,
  withoutOurHooks,
  type HookSetup,
} from './install'

function setup(): HookSetup {
  const home = mkdtempSync(join(tmpdir(), 'perch-home-'))
  return { home, cliPath: 'L:\\app\\out\\main\\perch-hook.js', inboxDir: 'L:\\app\\.data\\inbox' }
}

const theirs = { type: 'command', command: 'node C:/Users/me/.claude/hooks/format.cjs' }

describe('config transforms', () => {
  test('adding twice leaves one copy of ours and keeps other handlers in place', () => {
    const config = { model: 'x', hooks: { Stop: [{ hooks: [theirs] }], PreToolUse: [{ matcher: 'Bash', hooks: [theirs] }] } }
    const ours = { Stop: [{ hooks: [{ type: 'command', command: `node ${MARKER}.js` }] }] }

    const once = withOurHooks(config, ours)
    const twice = withOurHooks(once, ours)

    expect(twice).toEqual(once)
    expect(twice).toEqual({
      model: 'x',
      hooks: {
        Stop: [{ hooks: [theirs] }, { hooks: [{ type: 'command', command: `node ${MARKER}.js` }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [theirs] }],
      },
    })
    expect(withoutOurHooks(twice)).toEqual(config)
  })

  test('does not mutate the input', () => {
    const config = { hooks: { Stop: [{ hooks: [theirs] }] } }
    const copy = structuredClone(config)

    withOurHooks(config, { Stop: [{ hooks: [{ command: MARKER }] }] })

    expect(config).toEqual(copy)
  })
})

describe('install / uninstall on disk', () => {
  test('Claude Code: merges into an existing settings file, backs it up, and removes cleanly', () => {
    const s = setup()
    const file = join(s.home, '.claude', 'settings.json')
    mkdirSync(join(s.home, '.claude'))
    const original = { theme: 'dark', hooks: { Stop: [{ hooks: [theirs] }] } }
    writeFileSync(file, JSON.stringify(original))

    install('claude-code', s)
    const installed = JSON.parse(readFileSync(file, 'utf8'))

    expect(isInstalled('claude-code', s.home)).toBe(true)
    expect(installed.theme).toBe('dark')
    expect(installed.hooks.Stop).toHaveLength(2)
    expect(installed.hooks.Notification[0].matcher).toContain('permission_prompt')
    expect(installed.hooks.Stop[1].hooks[0].args).toEqual([s.cliPath, 'hook', 'claude-code', '--inbox', s.inboxDir])
    expect(JSON.parse(readFileSync(`${file}.perch.bak`, 'utf8'))).toEqual(original)

    uninstall('claude-code', s.home)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(original)
    expect(isInstalled('claude-code', s.home)).toBe(false)
  })

  test('Grok Build and OpenCode get their own files, deleted on uninstall', () => {
    const s = setup()

    const grok = install('grok-build', s)
    const plugin = install('opencode', s)

    expect(JSON.parse(readFileSync(grok, 'utf8')).hooks.StopCancelled).toHaveLength(1)
    expect(readFileSync(plugin, 'utf8')).toContain(JSON.stringify(s.inboxDir))
    uninstall('grok-build', s.home)
    uninstall('opencode', s.home)
    expect([existsSync(grok), existsSync(plugin)]).toEqual([false, false])
  })

  test('refuses to touch a config file that is not a JSON object', () => {
    const s = setup()
    mkdirSync(join(s.home, '.codex'))
    writeFileSync(join(s.home, '.codex', 'hooks.json'), '[1, 2]')

    expect(() => install('codex', s)).toThrow('left untouched')
    expect(readFileSync(join(s.home, '.codex', 'hooks.json'), 'utf8')).toBe('[1, 2]')
  })
})

describe('installState', () => {
  test('tells a missing agent from one without our hook', () => {
    const s = setup()
    expect(installState('codex', s)).toBe('no-agent')

    mkdirSync(join(s.home, '.codex'))
    expect(installState('codex', s)).toBe('not-installed')
  })

  test('a hook pointing at another copy of the app is outdated until reinstalled', () => {
    const s = setup()
    mkdirSync(join(s.home, '.codex'))
    install('codex', { ...s, cliPath: 'D:/old/perch-hook.js' })
    expect(installState('codex', s)).toBe('outdated')

    install('codex', s)
    expect(installState('codex', s)).toBe('installed')
  })

  test('OpenCode only needs the inbox to match', () => {
    const s = setup()
    install('opencode', { ...s, cliPath: 'elsewhere.js' })
    expect(installState('opencode', s)).toBe('installed')

    install('opencode', { ...s, inboxDir: 'D:/other/inbox' })
    expect(installState('opencode', s)).toBe('outdated')
  })
})

describe('hooks written before the rename (Tasks Calendar)', () => {
  const legacyHandler = { type: 'command', command: 'node', args: ['L:/old/tasks-calendar-hook.js', 'hook', 'claude-code'] }

  test('are found, reported as outdated, and replaced rather than duplicated', () => {
    const s = setup()
    const file = join(s.home, '.claude', 'settings.json')
    mkdirSync(join(s.home, '.claude'))
    writeFileSync(file, JSON.stringify({ hooks: { Stop: [{ hooks: [theirs] }, { hooks: [legacyHandler] }] } }))

    expect(installState('claude-code', s)).toBe('outdated')
    install('claude-code', s)

    const stop = JSON.parse(readFileSync(file, 'utf8')).hooks.Stop
    expect(stop).toHaveLength(2)
    expect(JSON.stringify(stop)).not.toContain('tasks-calendar-hook')
    expect(installState('claude-code', s)).toBe('installed')
  })

  test('an old own file is replaced by the new one, and uninstall clears both names', () => {
    const s = setup()
    const legacy = join(s.home, '.grok', 'hooks', 'tasks-calendar.json')
    mkdirSync(join(s.home, '.grok', 'hooks'), { recursive: true })
    writeFileSync(legacy, JSON.stringify({ hooks: { Stop: [{ hooks: [legacyHandler] }] } }))

    expect(installState('grok-build', s)).toBe('outdated')
    const written = install('grok-build', s)
    expect([existsSync(legacy), written.endsWith('perch.json')]).toEqual([false, true])

    writeFileSync(legacy, JSON.stringify({ hooks: { Stop: [{ hooks: [legacyHandler] }] } }))
    uninstall('grok-build', s.home)
    expect([existsSync(legacy), existsSync(written)]).toEqual([false, false])
  })
})

test('an old-name plugin is outdated even when it already writes to the right inbox', () => {
  const s = setup()
  const plugins = join(s.home, '.config', 'opencode', 'plugins')
  mkdirSync(plugins, { recursive: true })
  writeFileSync(join(plugins, 'tasks-calendar.js'), `// tasks-calendar-hook\nconst INBOX = ${JSON.stringify(s.inboxDir)}\n`)

  expect(installState('opencode', s)).toBe('outdated')
  install('opencode', s)
  expect([existsSync(join(plugins, 'tasks-calendar.js')), installState('opencode', s)]).toEqual([false, 'installed'])
})
