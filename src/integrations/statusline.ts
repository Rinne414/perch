import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StatuslineInfo } from '../shared/integrations'
import { MARKER, readJson, writeSafely, type Config, type HookSetup } from './install'

/*
 * Claude Code hands its usage limits only to the status line command. There is one per user, so:
 * - without a status line, ours is added and shows the usage under the prompt;
 * - with the person's own (for example ccstatusline), ours wraps it: it saves the usage for the app,
 *   then runs theirs with the same input and prints exactly what theirs printed. Claude Code looks
 *   the same as before, and removing ours puts theirs back as it was.
 */

const settingsFile = (home: string): string => join(home, '.claude', 'settings.json')

/** Where the person's own status line is kept while ours wraps it. */
export const wrappedFile = (s: HookSetup): string => join(s.inboxDir, 'quota', 'claude-code-statusline.json')

/**
 * The command runs in a shell (Git Bash, else PowerShell, on Windows), which eats unquoted
 * backslashes, so paths are written with forward slashes and quoted.
 */
const slashes = (path: string): string => path.split('\\').join('/')
export const statuslineCommand = (s: HookSetup, wrapping: boolean): string =>
  `node "${slashes(s.cliPath)}" statusline claude-code --inbox "${slashes(s.inboxDir)}"` +
  (wrapping ? ` --wrap "${slashes(wrappedFile(s))}"` : '')

type Line = Record<string, unknown>

const lineOf = (config: Config): Line | null => {
  const line = config['statusLine']
  return typeof line === 'object' && line !== null && !Array.isArray(line) ? (line as Line) : null
}

const commandOf = (line: Line): string => (typeof line['command'] === 'string' ? line['command'] : JSON.stringify(line))

/** The file named by --wrap "…" in one of our commands. */
const wrapPath = (command: string): string | null => /--wrap "([^"]+)"/.exec(command)?.[1] ?? null

export function readWrapped(file: string): Line | null {
  try {
    const line = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return typeof line === 'object' && line !== null && !Array.isArray(line) ? (line as Line) : null
  } catch {
    return null
  }
}

export function statuslineInfo(s: HookSetup): StatuslineInfo {
  if (!existsSync(join(s.home, '.claude'))) return { state: 'no-agent', other: null }
  const line = lineOf(readJson(settingsFile(s.home)))
  if (!line) return { state: 'not-installed', other: null }
  const command = commandOf(line)
  if (!command.includes(MARKER)) return { state: 'taken', other: command }
  const wrapFile = wrapPath(command)
  const wrapped = wrapFile ? readWrapped(wrapFile) : null
  const other = wrapped ? commandOf(wrapped) : null
  return { state: command === statuslineCommand(s, wrapFile !== null) ? 'installed' : 'outdated', other }
}

/** Adds ours, wrapping the person's own status line when there is one. */
export function installStatusline(s: HookSetup): string {
  const file = settingsFile(s.home)
  const config = readJson(file)
  const current = lineOf(config)
  let theirs: Line | null = null
  if (current && !commandOf(current).includes(MARKER)) theirs = current
  else if (current) {
    // Ours already, perhaps from another copy of the app: keep wrapping what it wrapped.
    const oldWrap = wrapPath(commandOf(current))
    theirs = oldWrap ? readWrapped(oldWrap) : null
  }
  if (theirs) {
    mkdirSync(join(s.inboxDir, 'quota'), { recursive: true })
    writeFileSync(wrappedFile(s), JSON.stringify(theirs, null, 2))
  }
  const padding = typeof current?.['padding'] === 'number' ? current['padding'] : 0
  const ours = { type: 'command', command: statuslineCommand(s, theirs !== null), padding }
  writeSafely(file, JSON.stringify({ ...config, statusLine: ours }, null, 2) + '\n')
  return file
}

/**
 * Takes ours out: the person's own status line goes back exactly as it was, or there is none again.
 * Returns null when there was nothing of ours. Refuses (and changes nothing) if theirs was lost.
 */
export function uninstallStatusline(home: string): string | null {
  const file = settingsFile(home)
  if (!existsSync(file)) return null
  const config = readJson(file)
  const current = lineOf(config)
  if (!current || !commandOf(current).includes(MARKER)) return null
  const wrapFile = wrapPath(commandOf(current))
  if (wrapFile) {
    const theirs = readWrapped(wrapFile)
    if (!theirs) throw new Error('The status line Perch wrapped is missing; settings left as they are')
    writeSafely(file, JSON.stringify({ ...config, statusLine: theirs }, null, 2) + '\n')
    rmSync(wrapFile, { force: true })
    return file
  }
  const { statusLine: _ours, ...rest } = config
  writeSafely(file, JSON.stringify(rest, null, 2) + '\n')
  return file
}
