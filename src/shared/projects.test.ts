import { describe, expect, test } from 'vitest'
import type { AgentSession } from './types'
import { groupProjects, projectAgeLabel, projectName, type ProjectSummary } from './projects'

const at = (d: number, h: number, m = 0): number => new Date(2026, 9, d, h, m).getTime()
const NOW = at(10, 15)

const session = (over: Partial<AgentSession> = {}): AgentSession => ({
  id: 'codex:s',
  agent: 'codex',
  sessionId: 's',
  cwd: 'D:\\code\\x',
  title: null,
  status: 'done',
  detail: null,
  startedAt: NOW,
  updatedAt: NOW,
  attentionAt: null,
  acknowledgedAt: null,
  ...over,
})

const summary = (cwd: string, lastAt: number, hidden = false): ProjectSummary => ({
  cwd,
  name: projectName(cwd)!,
  firstAt: lastAt,
  lastAt,
  sessionCount: 1,
  latest: session({ cwd, updatedAt: lastAt }),
  openItems: 0,
  hidden,
})

describe('projectName', () => {
  test('is the last folder of the path, on either kind of slash', () => {
    expect(projectName('D:\\code\\perch\\')).toBe('perch')
    expect(projectName('/home/me/blog')).toBe('blog')
    expect(projectName(null)).toBeNull()
  })
})

describe('projectAgeLabel', () => {
  test('recent work reads as time ago; a running agent is now', () => {
    expect(projectAgeLabel(summary('a', NOW - 2 * 60_000), NOW, 4)).toBe('2 分鐘前')
    expect(projectAgeLabel({ ...summary('a', NOW - 60_000), latest: session({ status: 'running', updatedAt: NOW - 60_000 }) }, NOW, 4)).toBe('現在')
  })

  test('counts whole days by the app’s day boundary', () => {
    expect(projectAgeLabel(summary('a', at(9, 22)), NOW, 4)).toBe('昨天')
    // 2 a.m. on the 10th still belongs to the 9th.
    expect(projectAgeLabel(summary('a', at(10, 2)), NOW, 4)).toBe('昨天')
    expect(projectAgeLabel(summary('a', at(8, 12)), NOW, 4)).toBe('2 天前')
  })

  test('from three days on it says how long it has been left alone', () => {
    expect(projectAgeLabel(summary('a', at(7, 12)), NOW, 4)).toBe('3 天沒碰')
  })
})

describe('groupProjects', () => {
  test('sorts into these days, resting, long untouched and hidden, newest first', () => {
    const groups = groupProjects(
      [
        summary('D:\\old', at(1, 12) - 30 * 86_400_000),
        summary('D:\\resting', at(5, 12)),
        summary('D:\\today', at(10, 9)),
        summary('D:\\yesterday', at(9, 9)),
        summary('D:\\hidden', at(10, 10), true),
      ],
      NOW,
      4,
    )

    expect(groups.recent.map((p) => p.cwd)).toEqual(['D:\\today', 'D:\\yesterday'])
    expect(groups.resting.map((p) => p.cwd)).toEqual(['D:\\resting'])
    expect(groups.old.map((p) => p.cwd)).toEqual(['D:\\old'])
    expect(groups.hidden.map((p) => p.cwd)).toEqual(['D:\\hidden'])
  })
})
