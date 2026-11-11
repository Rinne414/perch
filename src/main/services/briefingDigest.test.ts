import { describe, expect, test, vi } from 'vitest'
import { openDatabase } from '../db/connection'
import { applyAgentEvent } from '../db/agents'
import { getBriefingPayload } from './briefing'
import { DEFAULT_SETTINGS } from './settings'

// The reader trips on one reply: that session alone must lose its digest.
vi.mock('@shared/replyDigest', async (importOriginal) => {
  const real = await importOriginal<typeof import('@shared/replyDigest')>()
  return {
    ...real,
    digestReply: (reply: string | null) => {
      if (reply?.includes('TRIP')) throw new RangeError('reader tripped')
      return real.digestReply(reply)
    },
  }
})

const NOW = new Date(2026, 10, 11, 12, 0).getTime()

describe('a reply the digest trips on', () => {
  test('gives that session an empty digest and a log line; the rest of the briefing is whole', () => {
    const db = openDatabase(':memory:')
    const done = (sessionId: string, reply: string): void => {
      applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId, status: 'running', prompt: 'go' }, NOW - 20 * 60_000)
      applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId, status: 'done', reply }, NOW - 10 * 60_000)
    }
    done('bad', 'TRIP')
    done('good', ['## 需要你做的事', '- 看一眼'].join('\n'))
    const errors: string[] = []

    const b = getBriefingPayload(db, NOW, DEFAULT_SETTINGS, NOW - 3_600_000, null, { error: (message) => errors.push(message) })

    const byId = Object.fromEntries(b.done.map((d) => [d.session.sessionId, d.digest]))
    expect(byId.bad).toEqual({ conclusion: null, conclusionFromSection: false, todos: null, unverified: null })
    expect(byId.good.todos).toEqual(['看一眼'])
    expect(errors).toEqual(['Report digest failed for session claude-code:bad'])
  })
})
