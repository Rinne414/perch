import { closeSync, existsSync, fstatSync, openSync, readSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { HookState } from '../shared/integrations'
import { MARKER, readJson, readText, writeSafely, type Config, type HookSetup } from './configFile'

/**
 * Antigravity (the CLI `agy`, the IDE and Antigravity 2.0) reads lifecycle hooks from one
 * global hooks.json. Each top-level key is a named hook; ours is "perch", so other tools'
 * hooks (Orca's "orca-status", for one) are never touched.
 */
const HOOK_NAME = 'perch'
const WRAPPER = 'perch-hook.cmd'
/** Antigravity's own docs say a hook may run 30 s; ours writes one small file and is done. */
const TIMEOUT_S = 10
/** Turn start (with the prompt), tool steps, and the end of a run. PreToolUse is left alone: it must answer with a permission decision. */
export const ANTIGRAVITY_EVENTS = ['PreInvocation', 'PostToolUse', 'Stop'] as const
export type AntigravityEvent = (typeof ANTIGRAVITY_EVENTS)[number]
/** The transcript can grow long; the last turn is always near its end. */
const TAIL_BYTES = 256 * 1024

const configDir = (home: string): string => join(home, '.gemini', 'config')
export const antigravityHooksFile = (home: string): string => join(configDir(home), 'hooks.json')
const wrapperFile = (home: string): string => join(configDir(home), WRAPPER)

export const antigravityPresent = (home: string): boolean =>
  existsSync(configDir(home)) || existsSync(join(home, '.gemini', 'antigravity-cli'))

/** POSIX shells: single quotes keep a path literal; a quote inside is closed, escaped and reopened. */
const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/**
 * On Windows Antigravity runs a hook through `cmd /c` but passes double quotes on literally, so a
 * quoted path breaks, and it does not look in the hook's folder for a bare name. The hook is
 * therefore `.\perch-hook.cmd <Event>` (no spaces, no quotes), run in hooks.json's folder, and the
 * small script next to it holds the quoted paths.
 */
export function wrapperScript(s: HookSetup): string {
  // cmd reads a script in the console code page; UTF-8 is switched on only when a path needs it.
  const utf8 = /[^\x20-\x7e]/.test(s.cliPath + s.inboxDir) ? 'chcp 65001 >nul 2>&1\r\n' : ''
  return [
    '@echo off',
    `rem ${MARKER}: written by Perch. Reports Antigravity runs to the app; remove it in Perch's settings.`,
    `${utf8}node "${s.cliPath}" hook antigravity --event %1 --inbox "${s.inboxDir}"`,
    'exit /b 0',
    '',
  ].join('\r\n')
}

function command(s: HookSetup, event: AntigravityEvent, windows: boolean): string {
  if (windows) return `.\\${WRAPPER} ${event}`
  return `node ${shQuote(s.cliPath)} hook antigravity --event ${event} --inbox ${shQuote(s.inboxDir)}`
}

/** Our named hook: flat handler lists, except tool events which wrap handlers with a matcher. */
export function antigravityHook(s: HookSetup, windows = process.platform === 'win32'): Config {
  const handler = (event: AntigravityEvent): Config => ({ type: 'command', command: command(s, event, windows), timeout: TIMEOUT_S })
  return {
    PreInvocation: [handler('PreInvocation')],
    PostToolUse: [{ matcher: '*', hooks: [handler('PostToolUse')] }],
    Stop: [handler('Stop')],
  }
}

const ours = (config: Config): unknown => config[HOOK_NAME]

export function installAntigravity(s: HookSetup, windows = process.platform === 'win32'): string {
  const file = antigravityHooksFile(s.home)
  const config = readJson(file)
  if (windows) writeSafely(wrapperFile(s.home), wrapperScript(s))
  writeSafely(file, JSON.stringify({ ...config, [HOOK_NAME]: antigravityHook(s, windows) }, null, 2) + '\n')
  return file
}

export function uninstallAntigravity(home: string): string | null {
  const file = antigravityHooksFile(home)
  const wrapper = wrapperFile(home)
  if (readText(wrapper).includes(MARKER)) rmSync(wrapper)
  if (!existsSync(file)) return null
  const config = readJson(file)
  if (ours(config) === undefined) return null
  const rest = Object.fromEntries(Object.entries(config).filter(([name]) => name !== HOOK_NAME))
  writeSafely(file, JSON.stringify(rest, null, 2) + '\n')
  return file
}

export const antigravityInstalled = (home: string): boolean => existsSync(antigravityHooksFile(home)) && ours(readJson(antigravityHooksFile(home))) !== undefined

/** Installed when our hook has every event and its command (or the script it runs) points at this copy of the app. */
export function antigravityState(s: HookSetup, windows = process.platform === 'win32'): HookState {
  const file = antigravityHooksFile(s.home)
  const hook = existsSync(file) ? ours(readJson(file)) : undefined
  if (hook === undefined) return antigravityPresent(s.home) ? 'not-installed' : 'no-agent'
  const expected = JSON.stringify(antigravityHook(s, windows))
  const sameHook = JSON.stringify(hook) === expected
  const sameScript = !windows || readText(wrapperFile(s.home)) === wrapperScript(s)
  return sameHook && sameScript ? 'installed' : 'outdated'
}

/** Which Antigravity product ran the hook, from where it keeps the transcript. */
export function antigravityProduct(transcriptPath: unknown): 'antigravity-cli' | 'antigravity-ide' | 'antigravity' {
  const path = typeof transcriptPath === 'string' ? transcriptPath.replace(/\\/g, '/') : ''
  if (path.includes('/antigravity-cli/')) return 'antigravity-cli'
  if (path.includes('/antigravity-ide/')) return 'antigravity-ide'
  return 'antigravity'
}

interface TranscriptStep {
  readonly type?: unknown
  readonly content?: unknown
}

const steps = (lines: readonly string[]): TranscriptStep[] =>
  lines.flatMap((line) => {
    try {
      const step = JSON.parse(line) as unknown
      return typeof step === 'object' && step !== null ? [step as TranscriptStep] : []
    } catch {
      return []
    }
  })

/** What the person asked last: the text inside <USER_REQUEST>, or the whole input when it has none. */
export function lastUserRequest(lines: readonly string[]): string | undefined {
  const input = steps(lines)
    .reverse()
    .find((s) => s.type === 'USER_INPUT' && typeof s.content === 'string')
  if (!input) return undefined
  const text = input.content as string
  const inside = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/.exec(text)
  return (inside ? inside[1] : text).trim() || undefined
}

/** The model's last answer in the transcript. */
export function lastReply(lines: readonly string[]): string | undefined {
  const reply = steps(lines)
    .reverse()
    .find((s) => s.type === 'PLANNER_RESPONSE' && typeof s.content === 'string' && s.content.trim())
  return reply ? (reply.content as string) : undefined
}

/** The last lines of a transcript (only its tail is read); none when it cannot be read. */
export function readTranscriptTail(file: unknown): string[] {
  if (typeof file !== 'string' || !file.endsWith('.jsonl') || !existsSync(file)) return []
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    const start = Math.max(0, size - TAIL_BYTES)
    const buffer = Buffer.alloc(size - start)
    readSync(fd, buffer, 0, buffer.length, start)
    const lines = buffer.toString('utf8').split(/\r?\n/)
    // A cut-off first line is not JSON; drop it when the read did not start at the beginning.
    return (start > 0 ? lines.slice(1) : lines).filter(Boolean)
  } finally {
    closeSync(fd)
  }
}
