import { describe, expect, test } from 'vitest'
import { resumeCommand } from './agents'

const session = (agent: string, sessionId: string, cwd: string | null = 'L:\\code\\my app') => ({ agent, sessionId, cwd })

describe('resumeCommand', () => {
  test('goes to the project folder, then resumes with each agent’s own flag', () => {
    expect(resumeCommand(session('claude-code', '4f1c9a2e-0b7d-4c1e-9f7a-1234567890ab'))).toBe(
      "cd 'L:\\code\\my app'; claude --resume 4f1c9a2e-0b7d-4c1e-9f7a-1234567890ab",
    )
    expect(resumeCommand(session('codex', 'abc-123'))).toBe("cd 'L:\\code\\my app'; codex resume abc-123")
    expect(resumeCommand(session('opencode', 'ses_9Xk2'))).toBe("cd 'L:\\code\\my app'; opencode --session ses_9Xk2")
    expect(resumeCommand(session('grok-build', 'g-1'))).toBe("cd 'L:\\code\\my app'; grok --resume g-1")
  })

  test('without a folder it is only the resume part', () => {
    expect(resumeCommand(session('codex', 'abc', null))).toBe('codex resume abc')
  })

  test('refuses anything that could turn into a different command when pasted', () => {
    expect(resumeCommand(session('claude-code', 'x; rm -rf ~'))).toBeNull()
    expect(resumeCommand(session('claude-code', 'ok', "C:\\a'; calc; '"))).toBe('claude --resume ok')
    expect(resumeCommand(session('kiro', 'abc'))).toBeNull()
  })
})
