import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { install, type HookSetup } from '../../integrations/install'
import { openDatabase } from '../db/connection'
import { integrationsPayload } from './integrations'

function setup(): HookSetup {
  const home = mkdtempSync(join(tmpdir(), 'perch-int-'))
  mkdirSync(join(home, '.gemini', 'config'), { recursive: true })
  return { home, cliPath: 'L:\\app\\out\\main\\perch-hook.js', inboxDir: 'L:\\app\\.data\\inbox' }
}

const agents = (s: HookSetup): string[] => integrationsPayload(openDatabase(':memory:'), s).agents.map((a) => a.agent)

describe('agents listed in 設定', () => {
  test('Antigravity is offered; Gemini CLI is not, since it became Antigravity CLI', () => {
    const list = agents(setup())
    expect(list).toContain('antigravity')
    expect(list).not.toContain('gemini-cli')
  })

  test('Gemini CLI shows up while an old hook of ours is still in its config, so it can be removed', () => {
    const s = setup()
    install('gemini-cli', s)
    expect(agents(s)).toContain('gemini-cli')
  })
})
