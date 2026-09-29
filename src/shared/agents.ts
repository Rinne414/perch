import type { AgentStatus } from './types'

/** Agents this build knows how to hook into. Other names still work; they just show as-is. */
export const AGENT_NAMES: Readonly<Record<string, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
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

/** How each agent's CLI reopens a past session (checked against each CLI's --help, 2026-10). */
const RESUME: Readonly<Record<string, (id: string) => string>> = {
  'claude-code': (id) => `claude --resume ${id}`,
  codex: (id) => `codex resume ${id}`,
  opencode: (id) => `opencode --session ${id}`,
  'grok-build': (id) => `grok --resume ${id}`,
}

/** Session ids are UUIDs or short slugs; anything else is not pasted into a shell. */
const SAFE_ID = /^[\w.-]{1,128}$/

/**
 * A command that takes the person back into a session: go to its folder, then resume.
 * Single quotes keep the path literal in PowerShell and POSIX shells alike.
 */
export function resumeCommand(s: { agent: string; sessionId: string; cwd: string | null }): string | null {
  const make = RESUME[s.agent]
  if (!make || !SAFE_ID.test(s.sessionId)) return null
  const resume = make(s.sessionId)
  return s.cwd && !s.cwd.includes("'") ? `cd '${s.cwd}'; ${resume}` : resume
}
