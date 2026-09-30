import type { AgentEvent } from '../shared/agentEvent'
import { promptTitle } from '../shared/prompt'
import type { AgentStatus } from '../shared/types'

/** Agents that report through command hooks. OpenCode reports through its own plugin instead. */
export const HOOK_AGENTS = ['claude-code', 'codex', 'gemini-cli', 'grok-build'] as const
export type HookAgent = (typeof HOOK_AGENTS)[number]

export const isHookAgent = (v: string): v is HookAgent => (HOOK_AGENTS as readonly string[]).includes(v)

type Payload = Record<string, unknown>

const MAX_LINE = 160

/** First non-empty line, shortened: enough to recognise a prompt or a result. */
export function firstLine(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const line = v
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean)
  if (!line) return undefined
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line
}

/** A prompt's title, skipping blocks like pasted text; undefined when there is no prompt. */
const promptOf = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? promptTitle(v) : undefined)

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

interface Mapped {
  readonly status: AgentStatus
  readonly title?: string
  readonly detail?: string
}

function claudeCode(p: Payload): Mapped | null {
  // Grok Build also runs hooks from ~/.claude/settings.json; its own hook reports those turns.
  if ('hookEventName' in p) return null
  // Hooks fired inside a subagent describe the subagent, not the session the person started.
  if (p['agent_id'] !== undefined) return null
  switch (p['hook_event_name']) {
    case 'UserPromptSubmit':
      return { status: 'running', title: promptOf(p['prompt']) }
    case 'PostToolUse':
      return { status: 'running' }
    case 'Stop':
      return { status: 'done', detail: firstLine(p['last_assistant_message']) }
    case 'StopFailure':
      return { status: 'failed', detail: firstLine(p['error_details']) ?? firstLine(p['error']) ?? 'API 錯誤' }
    case 'Notification': {
      const type = str(p['notification_type'])
      const waiting = ['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']
      return type && waiting.includes(type) ? { status: 'needs_input', detail: firstLine(p['message']) } : null
    }
    case 'SessionEnd':
      return { status: 'cancelled' }
    default:
      return null
  }
}

function codex(p: Payload): Mapped | null {
  switch (p['hook_event_name']) {
    case 'UserPromptSubmit':
      return { status: 'running', title: promptOf(p['prompt']) }
    case 'PostToolUse':
      return { status: 'running' }
    case 'Stop':
      return { status: 'done', detail: firstLine(p['last_assistant_message']) }
    case 'PermissionRequest': {
      const input = (p['tool_input'] ?? {}) as Payload
      const what = firstLine(input['description']) ?? firstLine(input['command'])
      const tool = str(p['tool_name'])
      return { status: 'needs_input', detail: what ?? (tool ? `要使用 ${tool}` : undefined) }
    }
    case 'SessionEnd':
      return { status: 'cancelled' }
    default:
      return null
  }
}

function geminiCli(p: Payload): Mapped | null {
  switch (p['hook_event_name']) {
    case 'BeforeAgent':
      return { status: 'running', title: promptOf(p['prompt']) }
    case 'AfterTool':
      return { status: 'running' }
    case 'AfterAgent':
      return { status: 'done', detail: firstLine(p['prompt_response']) }
    case 'Notification':
      return p['notification_type'] === 'ToolPermission'
        ? { status: 'needs_input', detail: firstLine(p['message']) }
        : null
    case 'SessionEnd':
      return { status: 'cancelled' }
    default:
      return null
  }
}

function grokBuild(p: Payload): Mapped | null {
  if (p['subagentType'] !== undefined) return null
  switch (p['hook_event_name']) {
    case 'UserPromptSubmit':
      return { status: 'running', title: promptOf(p['prompt']) }
    case 'PostToolUse':
      return { status: 'running' }
    case 'Stop':
      // A second Stop fires when the session closes; only "end_turn" is a finished turn.
      if (p['reason'] !== undefined && p['reason'] !== 'end_turn') return { status: 'cancelled' }
      return { status: 'done', detail: firstLine(p['lastAssistantMessage']) }
    case 'StopFailure':
      return { status: 'failed', detail: firstLine(p['errorDetails']) ?? firstLine(p['error']) ?? 'API 錯誤' }
    case 'StopCancelled':
      // The person stopped it themselves, or the agent gave up (turn limit, no progress).
      return p['cancelledBy'] === 'user'
        ? { status: 'cancelled' }
        : { status: 'failed', detail: firstLine(p['reasonDetails']) ?? str(p['reason']) }
    case 'Notification':
      return p['notificationType'] === 'permission_prompt'
        ? { status: 'needs_input', detail: firstLine(p['message']) }
        : null
    case 'SessionEnd':
      return { status: 'cancelled' }
    default:
      return null
  }
}

const MAPPERS: Record<HookAgent, (p: Payload) => Mapped | null> = {
  'claude-code': claudeCode,
  codex,
  'gemini-cli': geminiCli,
  'grok-build': grokBuild,
}

/** Turns one hook payload into the public event format, or null when it is not worth reporting. */
export function hookPayloadToEvent(agent: HookAgent, payload: unknown, now: number): AgentEvent | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Payload
  const sessionId = str(p['session_id']) ?? str(p['sessionId'])
  if (!sessionId) return null
  const mapped = MAPPERS[agent](p)
  if (!mapped) return null
  return {
    v: 1,
    agent,
    sessionId,
    status: mapped.status,
    at: now,
    cwd: str(p['cwd']),
    ...(mapped.title ? { title: mapped.title } : {}),
    ...(mapped.detail ? { detail: mapped.detail } : {}),
  }
}
