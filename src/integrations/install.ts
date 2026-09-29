import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { HookState } from '../shared/integrations'

/** Every command we install contains this, so our entries can be found and removed again. */
export const MARKER = 'perch-hook'

/**
 * Hooks written before the app was renamed from "Tasks Calendar". They are still
 * recognised, reported as outdated, and replaced (never duplicated) on install.
 */
const LEGACY_MARKER = 'tasks-calendar-hook'

const hasOurMarker = (text: string): boolean => text.includes(MARKER) || text.includes(LEGACY_MARKER)

export const INSTALLABLE = ['claude-code', 'codex', 'gemini-cli', 'grok-build', 'opencode'] as const
export type InstallableAgent = (typeof INSTALLABLE)[number]

export const isInstallable = (v: string): v is InstallableAgent => (INSTALLABLE as readonly string[]).includes(v)

export interface HookSetup {
  /** Absolute path of the built hook script (…/perch-hook.js). */
  readonly cliPath: string
  readonly inboxDir: string
  readonly home: string
}

type Handler = Record<string, unknown>
interface HookGroup {
  matcher?: string
  hooks: Handler[]
}
type HooksMap = Record<string, HookGroup[]>
type Config = Record<string, unknown>

const commandLine = (s: HookSetup, agent: string): string =>
  `node "${s.cliPath}" hook ${agent} --inbox "${s.inboxDir}"`

const isOurs = (h: Handler): boolean => hasOurMarker(JSON.stringify(h))

/** A copy of the config without any of our handlers; everything else is left exactly as it was. */
export function withoutOurHooks(config: Config): Config {
  const hooks = config['hooks']
  if (typeof hooks !== 'object' || hooks === null) return config
  const cleaned: HooksMap = {}
  for (const [event, groups] of Object.entries(hooks as HooksMap)) {
    if (!Array.isArray(groups)) {
      cleaned[event] = groups
      continue
    }
    const kept = groups
      .map((g) => (Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isOurs(h)) } : g))
      .filter((g) => !Array.isArray(g?.hooks) || g.hooks.length > 0)
    if (kept.length > 0) cleaned[event] = kept
  }
  return { ...config, hooks: cleaned }
}

/** Adds our handlers, replacing any older copy of them. */
export function withOurHooks(config: Config, ours: HooksMap): Config {
  const base = withoutOurHooks(config)
  const hooks = { ...((base['hooks'] as HooksMap | undefined) ?? {}) }
  for (const [event, groups] of Object.entries(ours)) hooks[event] = [...(hooks[event] ?? []), ...groups]
  return { ...base, hooks }
}

const group = (handler: Handler, matcher?: string): HookGroup[] => [matcher ? { matcher, hooks: [handler] } : { hooks: [handler] }]

/** Hooks per agent. Event names and payloads were checked against each agent's docs (2026-09). */
export function hooksFor(agent: Exclude<InstallableAgent, 'opencode'>, s: HookSetup): HooksMap {
  switch (agent) {
    case 'claude-code': {
      // Exec form: no shell parsing, so paths with spaces or CJK need no quoting.
      const h = { type: 'command', command: 'node', args: [s.cliPath, 'hook', agent, '--inbox', s.inboxDir], timeout: 10 }
      return {
        UserPromptSubmit: group(h),
        PostToolUse: group({ ...h, async: true }),
        Stop: group(h),
        StopFailure: group(h),
        Notification: group(h, 'permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input'),
        SessionEnd: group(h),
      }
    }
    case 'codex': {
      const cmd = commandLine(s, agent)
      const h = { type: 'command', command: cmd, commandWindows: cmd, timeout: 10 }
      return {
        UserPromptSubmit: group(h),
        PostToolUse: group(h),
        Stop: group(h),
        PermissionRequest: group(h),
        SessionEnd: group(h),
      }
    }
    case 'gemini-cli': {
      const h = { type: 'command', command: commandLine(s, agent), timeout: 10_000 }
      return {
        BeforeAgent: group(h),
        AfterTool: group(h),
        AfterAgent: group(h),
        Notification: group(h),
        SessionEnd: group(h),
      }
    }
    case 'grok-build': {
      const h = { type: 'command', command: commandLine(s, agent), timeout: 10 }
      return {
        UserPromptSubmit: group(h),
        PostToolUse: group(h),
        Stop: group(h),
        StopFailure: group(h),
        StopCancelled: group(h),
        Notification: group(h, 'permission_prompt'),
        SessionEnd: group(h),
      }
    }
  }
}

/** OpenCode has no command hooks; a small plugin writes to the inbox directly. */
export function openCodePlugin(s: HookSetup): string {
  return `// ${MARKER}: written by Perch. Reports OpenCode session state to the app.
// Remove it from Perch's settings, or delete this file.
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

const INBOX = ${JSON.stringify(s.inboxDir)}

// With a file named "debug" in the inbox, raw events are kept in <inbox>/raw.
function keepRaw(event) {
  try {
    if (!existsSync(join(INBOX, 'debug'))) return
    mkdirSync(join(INBOX, 'raw'), { recursive: true })
    writeFileSync(join(INBOX, 'raw', Date.now() + '-opencode-' + event.type + '.json'), JSON.stringify(event))
  } catch {
    // Debug output is best effort.
  }
}

function write(event) {
  try {
    mkdirSync(INBOX, { recursive: true })
    const name = Date.now() + '-' + randomBytes(4).toString('hex') + '.json'
    const tmp = join(INBOX, name + '.tmp')
    writeFileSync(tmp, JSON.stringify(event))
    renameSync(tmp, join(INBOX, name))
  } catch {
    // Reporting must never break OpenCode.
  }
}

const line = (v) => (typeof v === 'string' && v.trim() ? v.trim().split(/\\r?\\n/)[0].slice(0, 160) : undefined)

export const Perch = async ({ directory }) => {
  // Subagent (child) sessions and the idle that follows an error are not news to the person.
  const children = new Set()
  const erred = new Set()
  const report = (sessionId, status, detail) => {
    if (!sessionId || children.has(sessionId)) return
    write({ v: 1, agent: 'opencode', sessionId, status, at: Date.now(), cwd: directory, ...(detail ? { detail } : {}) })
  }
  return {
    event: async ({ event }) => {
      keepRaw(event)
      const p = event.properties ?? {}
      const id = p.sessionID ?? p.info?.id
      if (p.info?.parentID && p.info?.id) children.add(p.info.id)
      switch (event.type) {
        case 'session.status':
          if (p.status?.type === 'busy') {
            erred.delete(id)
            report(id, 'running')
          }
          break
        case 'session.idle':
          if (erred.has(id)) erred.delete(id)
          else report(id, 'done')
          break
        case 'session.error':
          erred.add(id)
          report(id, 'failed', line(p.error?.data?.message) ?? line(p.error?.name))
          break
        case 'permission.asked':
        case 'permission.updated':
          report(id, 'needs_input', line(p.title))
          break
        case 'permission.replied':
          report(id, 'running')
          break
      }
    },
  }
}
`
}

interface Target {
  readonly file: string
  /** True when the whole file is ours (removed on uninstall); false when we edit a shared config. */
  readonly ownFile: boolean
  /** Our own file under the app's old name, cleaned up on install and uninstall. */
  readonly legacyFile?: string
}

export function targetFor(agent: InstallableAgent, home: string): Target {
  switch (agent) {
    case 'claude-code':
      return { file: join(home, '.claude', 'settings.json'), ownFile: false }
    case 'codex':
      return { file: join(home, '.codex', 'hooks.json'), ownFile: false }
    case 'gemini-cli':
      return { file: join(home, '.gemini', 'settings.json'), ownFile: false }
    case 'grok-build':
      return {
        file: join(home, '.grok', 'hooks', 'perch.json'),
        ownFile: true,
        legacyFile: join(home, '.grok', 'hooks', 'tasks-calendar.json'),
      }
    case 'opencode':
      return {
        file: join(home, '.config', 'opencode', 'plugins', 'perch.js'),
        ownFile: true,
        legacyFile: join(home, '.config', 'opencode', 'plugins', 'tasks-calendar.js'),
      }
  }
}

/** The agent counts as present when its config folder exists. */
export function agentPresent(agent: InstallableAgent, home: string): boolean {
  const folder = { 'claude-code': '.claude', codex: '.codex', 'gemini-cli': '.gemini', 'grok-build': '.grok', opencode: join('.config', 'opencode') }[agent]
  return existsSync(join(home, folder))
}

const readText = (file: string | undefined): string => (file && existsSync(file) ? readFileSync(file, 'utf8') : '')

/** The text of our hook's config: the current file, or an own file still under the old name. */
function configText(agent: InstallableAgent, home: string): string {
  const { file, legacyFile } = targetFor(agent, home)
  const current = readText(file)
  return hasOurMarker(current) ? current : readText(legacyFile) || current
}

export function isInstalled(agent: InstallableAgent, home: string): boolean {
  return hasOurMarker(configText(agent, home))
}

const escapedInJson = (path: string): string => JSON.stringify(path).slice(1, -1)

/** Whether our hook is in place and still points at this copy of the app. */
export function installState(agent: InstallableAgent, s: HookSetup): HookState {
  const text = configText(agent, s.home)
  if (!hasOurMarker(text)) return agentPresent(agent, s.home) ? 'not-installed' : 'no-agent'
  // Only the old name found: it still has to be replaced, wherever it points.
  if (!text.includes(MARKER)) return 'outdated'
  // The OpenCode plugin writes to the inbox itself and never calls the hook script.
  const paths = agent === 'opencode' ? [s.inboxDir] : [s.cliPath, s.inboxDir]
  return paths.every((path) => text.includes(escapedInJson(path))) ? 'installed' : 'outdated'
}

function readJson(file: string): Config {
  if (!existsSync(file)) return {}
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '')
  if (!text.trim()) return {}
  const parsed = JSON.parse(text) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${file} is not a JSON object; left untouched`)
  }
  return parsed as Config
}

/** Writes via a temp file after keeping one backup of the previous version. */
function writeSafely(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file)) copyFileSync(file, `${file}.perch.bak`)
  const tmp = `${file}.perch.tmp`
  writeFileSync(tmp, content, 'utf8')
  copyFileSync(tmp, file)
  rmSync(tmp, { force: true })
}

/** Deletes an own file only when it is really ours. */
function removeOwnFile(file: string | undefined): void {
  if (file && hasOurMarker(readText(file))) rmSync(file)
}

export function install(agent: InstallableAgent, s: HookSetup): string {
  const { file, legacyFile } = targetFor(agent, s.home)
  removeOwnFile(legacyFile)
  if (agent === 'opencode') {
    writeSafely(file, openCodePlugin(s))
    return file
  }
  if (agent === 'grok-build') {
    writeSafely(file, JSON.stringify({ hooks: hooksFor(agent, s) }, null, 2) + '\n')
    return file
  }
  const next = withOurHooks(readJson(file), hooksFor(agent, s))
  writeSafely(file, JSON.stringify(next, null, 2) + '\n')
  return file
}

export function uninstall(agent: InstallableAgent, home: string): string | null {
  const { file, ownFile, legacyFile } = targetFor(agent, home)
  if (ownFile) {
    const found = [file, legacyFile].filter((f): f is string => !!f && hasOurMarker(readText(f)))
    found.forEach((f) => rmSync(f))
    return found[0] ?? null
  }
  if (!existsSync(file)) return null
  const current = readJson(file)
  if (!hasOurMarker(JSON.stringify(current))) return null
  writeSafely(file, JSON.stringify(withoutOurHooks(current), null, 2) + '\n')
  return file
}
