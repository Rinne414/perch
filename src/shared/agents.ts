import type { AgentStatus } from './types'

/** Agents this build knows how to hook into. Other names still work; they just show as-is. */
export const AGENT_NAMES: Readonly<Record<string, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
  'antigravity-cli': 'Antigravity CLI',
  'antigravity-ide': 'Antigravity IDE',
  'gemini-cli': 'Gemini CLI',
  opencode: 'OpenCode',
  'grok-build': 'Grok Build',
  kiro: 'Kiro',
}

export const agentName = (agent: string): string => AGENT_NAMES[agent] ?? agent

/** States in which a session is waiting on the person, not the other way round. */
export const ATTENTION_STATUSES: ReadonlySet<AgentStatus> = new Set(['needs_input', 'done', 'failed'])

export const STATUS_LABEL: Readonly<Record<AgentStatus, string>> = {
  running: '執行中',
  needs_input: '等你回覆',
  done: '完成',
  failed: '失敗',
  cancelled: '已中斷',
}

/** How each agent's CLI reopens a past session, as program and arguments (checked against each CLI's --help, 2026-10). */
const RESUME: Readonly<Record<string, (id: string) => readonly string[]>> = {
  'claude-code': (id) => ['claude', '--resume', id],
  codex: (id) => ['codex', 'resume', id],
  opencode: (id) => ['opencode', '--session', id],
  'grok-build': (id) => ['grok', '--resume', id],
  'antigravity-cli': (id) => ['agy', '--conversation', id],
}

/**
 * Agents whose sessions are offered again after a restart. They report a session closing
 * (SessionEnd), so one still open can be told from one closed, and they resume by id.
 * OpenCode and Antigravity report no session end.
 */
export const REOPENABLE_AGENTS: readonly string[] = ['claude-code', 'codex', 'grok-build']

/**
 * Session ids are UUIDs or short slugs; anything else is not passed to a shell or a terminal.
 * The first character is a letter or digit, so an id can never read as an option ("--…").
 */
const SAFE_ID = /^\w[\w.-]{0,127}$/

/** The program and arguments that reopen a session; null when the agent has none or the id is not plain. */
export function resumeArgs(s: { agent: string; sessionId: string }): readonly string[] | null {
  // hasOwn: an agent named "constructor" must not find Object's own function.
  return Object.hasOwn(RESUME, s.agent) && SAFE_ID.test(s.sessionId) ? RESUME[s.agent](s.sessionId) : null
}

/**
 * A command that takes the person back into a session: go to its folder, then resume.
 * Single quotes keep the path literal in PowerShell and POSIX shells alike.
 */
export function resumeCommand(s: { agent: string; sessionId: string; cwd: string | null }): string | null {
  const args = resumeArgs(s)
  if (!args) return null
  const resume = args.join(' ')
  return s.cwd && !s.cwd.includes("'") ? `cd '${s.cwd}'; ${resume}` : resume
}
