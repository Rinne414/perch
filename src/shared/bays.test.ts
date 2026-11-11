import { describe, expect, test } from 'vitest'
import { buildBays, MAX_BAYS, NO_FOLDER, NO_FOLDER_KEY, OTHER_KEY, OTHER_PROJECTS, type MapSession } from './bays'
import type { SessionGroup } from './sessionState'
import type { AgentSession, AgentStatus } from './types'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = new Date(2026, 10, 11, 14, 0).getTime()

let seq = 0
function item(folder: string | null, group: SessionGroup, over: Partial<AgentSession> = {}, since = NOW - 5 * MIN): MapSession {
  seq++
  const status: AgentStatus = group === 'waiting' ? 'needs_input' : group === 'running' ? 'running' : 'done'
  return {
    group,
    since,
    session: {
      id: `s${seq}`,
      agent: 'claude-code',
      sessionId: `s${seq}`,
      cwd: folder === null ? null : `C:\\code\\${folder}`,
      name: `工作 ${seq}`,
      title: null,
      status,
      detail: null,
      startedAt: NOW - HOUR,
      updatedAt: NOW - seq * MIN,
      attentionAt: null,
      acknowledgedAt: null,
      endedAt: null,
      reopenedAt: null,
      ...over,
    },
  }
}

describe('buildBays', () => {
  test('one bay per project, coloured by its most urgent session, rows most urgent first', () => {
    const bays = buildBays(
      [item('perch', 'done'), item('perch', 'waiting'), item('game', 'running'), item(null, 'unattended', { updatedAt: NOW - 3 * 24 * HOUR })],
      NOW,
      4,
    )

    expect(bays.map((b) => [b.name, b.state, b.side])).toEqual([
      ['perch', 'waiting', 'left'],
      ['game', 'running', 'right'],
      [NO_FOLDER, 'unattended', 'left'],
    ])
    expect(bays[0].rows.map((r) => r.state)).toEqual(['waiting', 'done'])
  })

  test('urgency: asking > failed > running > done > left', () => {
    const bays = buildBays(
      [item('a', 'unattended'), item('b', 'done'), item('c', 'running'), item('d', 'waiting', { status: 'failed' }), item('e', 'waiting')],
      NOW,
      4,
    )

    expect(bays.map((b) => b.state)).toEqual(['waiting', 'failed', 'running', 'done', 'unattended'])
  })

  test('a failed session from the pile still makes its bay 失敗, above a running one', () => {
    const bays = buildBays([item('crawler', 'done'), item('crawler', 'unattended', { status: 'failed' }), item('game', 'running')], NOW, 4)

    expect(bays.map((b) => [b.name, b.state])).toEqual([
      ['crawler', 'failed'],
      ['game', 'running'],
    ])
    expect(bays[0].rows.map((r) => r.state)).toEqual(['failed', 'done'])
  })

  test('the same urgency goes by the most recently moved', () => {
    const older = item('old', 'done', { updatedAt: NOW - 3 * HOUR })
    const newer = item('new', 'done', { updatedAt: NOW - MIN })
    expect(buildBays([older, newer], NOW, 4).map((b) => b.name)).toEqual(['new', 'old'])
  })

  test('short times: waiting, running, a finished clock time, a left age', () => {
    const bays = buildBays(
      [
        item('w', 'waiting', {}, NOW - 2 * MIN),
        item('r', 'running', { startedAt: NOW - 5 * MIN }),
        item('d', 'done', {}, new Date(2026, 10, 11, 13, 52).getTime()),
        item('u', 'unattended', { updatedAt: NOW - 3 * 24 * HOUR - HOUR }),
      ],
      NOW,
      4,
    )

    expect(bays.flatMap((b) => b.rows.map((r) => r.time))).toEqual(['等 2 分', '跑 5 分', '13:52', '3 天'])
  })

  test(`at most ${MAX_BAYS} bays; the least urgent projects share ${OTHER_PROJECTS}`, () => {
    const many = Array.from({ length: 11 }, (_, i) => item(`p${i}`, i < 2 ? 'waiting' : 'done'))
    const bays = buildBays(many, NOW, 4)

    expect(bays).toHaveLength(MAX_BAYS)
    expect(bays.at(-1)?.name).toBe(OTHER_PROJECTS)
    expect(bays.at(-1)?.rows).toHaveLength(4)
    expect(bays.slice(0, 2).every((b) => b.state === 'waiting')).toBe(true)
    expect(bays.map((b) => b.side)).toEqual(['left', 'right', 'left', 'right', 'left', 'right', 'left', 'right'])
  })

  test('two folders with the same name are two bays, each shown with its parent', () => {
    const a = item('x', 'done', { cwd: 'C:\\a\\app' })
    const b = item('x', 'running', { cwd: 'D:\\b\\app' })
    const c = item('x', 'done', { cwd: 'C:\\a\\app\\' })

    const bays = buildBays([a, b, c], NOW, 4)

    expect(bays.map((bay) => [bay.key, bay.name, bay.rows.length])).toEqual([
      ['D:\\b\\app', 'b\\app', 1],
      ['C:\\a\\app', 'a\\app', 2],
    ])
  })

  test(`a folder named ${OTHER_PROJECTS} or ${NO_FOLDER} never shares a key with the bays of those names`, () => {
    const many = [item(OTHER_PROJECTS, 'waiting'), item(NO_FOLDER, 'waiting'), item(null, 'waiting'), ...Array.from({ length: 9 }, (_, i) => item(`p${i}`, 'done'))]
    const keys = buildBays(many, NOW, 4).map((b) => b.key)

    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual(expect.arrayContaining([`C:\\code\\${OTHER_PROJECTS}`, `C:\\code\\${NO_FOLDER}`, NO_FOLDER_KEY, OTHER_KEY]))
  })

  test('nothing gives no bays', () => {
    expect(buildBays([], NOW, 4)).toEqual([])
  })
})
