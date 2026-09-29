import { describe, expect, test } from 'vitest'
import { firstLine, hookPayloadToEvent } from './adapters'

const NOW = 1_700_000_000_000

describe('claude-code', () => {
  const base = { session_id: 's1', cwd: 'L:\\code\\app' }

  test('a submitted prompt marks the session running and names it', () => {
    expect(hookPayloadToEvent('claude-code', { ...base, hook_event_name: 'UserPromptSubmit', prompt: '\n修好登入頁\n細節…' }, NOW)).toEqual({
      v: 1,
      agent: 'claude-code',
      sessionId: 's1',
      status: 'running',
      at: NOW,
      cwd: 'L:\\code\\app',
      title: '修好登入頁',
    })
  })

  test('Stop is done; a permission prompt waits on the person; idle prompts are ignored', () => {
    const stop = hookPayloadToEvent('claude-code', { ...base, hook_event_name: 'Stop', last_assistant_message: '改好了。' }, NOW)
    const perm = hookPayloadToEvent(
      'claude-code',
      { ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' },
      NOW,
    )
    const idle = hookPayloadToEvent('claude-code', { ...base, hook_event_name: 'Notification', notification_type: 'idle_prompt' }, NOW)

    expect(stop).toMatchObject({ status: 'done', detail: '改好了。' })
    expect(perm).toMatchObject({ status: 'needs_input', detail: 'Claude needs your permission to use Bash' })
    expect(idle).toBeNull()
  })

  test('ignores subagent hooks and Grok payloads arriving through the Claude settings file', () => {
    expect(hookPayloadToEvent('claude-code', { ...base, hook_event_name: 'Stop', agent_id: 'sub-1' }, NOW)).toBeNull()
    expect(hookPayloadToEvent('claude-code', { sessionId: 'g', hookEventName: 'stop', hook_event_name: 'Stop' }, NOW)).toBeNull()
  })
})

describe('codex', () => {
  test('a permission request carries what is being asked', () => {
    const e = hookPayloadToEvent(
      'codex',
      { session_id: 'c', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -r build' } },
      NOW,
    )

    expect(e).toMatchObject({ agent: 'codex', status: 'needs_input', detail: 'rm -r build' })
  })
})

describe('gemini-cli', () => {
  test('maps agent turns and tool permission notifications', () => {
    const base = { session_id: 'g', hook_event_name: 'AfterAgent', prompt_response: 'Done.' }

    expect(hookPayloadToEvent('gemini-cli', base, NOW)).toMatchObject({ status: 'done', detail: 'Done.' })
    expect(
      hookPayloadToEvent('gemini-cli', { session_id: 'g', hook_event_name: 'Notification', notification_type: 'ToolPermission', message: 'Allow shell?' }, NOW),
    ).toMatchObject({ status: 'needs_input' })
  })
})

describe('grok-build', () => {
  const base = { sessionId: 'k', hookEventName: 'stop', hook_event_name: 'Stop', cwd: '/w' }

  test('only an end_turn Stop is a finished turn; the session-end Stop cancels', () => {
    expect(hookPayloadToEvent('grok-build', { ...base, reason: 'end_turn', lastAssistantMessage: 'ok' }, NOW)).toMatchObject({
      status: 'done',
      detail: 'ok',
    })
    expect(hookPayloadToEvent('grok-build', { ...base, reason: 'shutdown' }, NOW)).toMatchObject({ status: 'cancelled' })
  })

  test('a runtime give-up needs a look; a user interrupt does not', () => {
    const cancelled = { ...base, hook_event_name: 'StopCancelled', reason: 'max_turns', cancelledBy: 'runtime' }

    expect(hookPayloadToEvent('grok-build', cancelled, NOW)).toMatchObject({ status: 'failed', detail: 'max_turns' })
    expect(hookPayloadToEvent('grok-build', { ...cancelled, cancelledBy: 'user' }, NOW)).toMatchObject({ status: 'cancelled' })
  })

  test('skips subagent turns', () => {
    expect(hookPayloadToEvent('grok-build', { ...base, subagentType: 'explore' }, NOW)).toBeNull()
  })
})

describe('input hygiene', () => {
  test('payloads without a session id or of the wrong shape are dropped', () => {
    expect(hookPayloadToEvent('codex', { hook_event_name: 'Stop' }, NOW)).toBeNull()
    expect(hookPayloadToEvent('codex', 'Stop', NOW)).toBeNull()
  })

  test('firstLine trims and shortens long text', () => {
    expect(firstLine('  \n  hello  \nworld')).toBe('hello')
    expect(firstLine('x'.repeat(200))).toHaveLength(160)
  })
})
