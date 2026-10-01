import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { applyAgentEvent } from '../db/agents'
import { openDatabase } from '../db/connection'
import { completeItem, createItem } from '../db/items'
import { captureForProject, listProjects, projectDetail, projectFolder, setProjectHidden } from './projects'
import { DEFAULT_SETTINGS } from './settings'

const T0 = 1_000_000

let db: DatabaseSync
let dir: string
beforeEach(() => {
  db = openDatabase(':memory:')
  dir = mkdtempSync(join(tmpdir(), 'perch-projects-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const reported = (cwd: string): void => {
  applyAgentEvent(db, { v: 1, agent: 'codex', sessionId: cwd, status: 'running', cwd, at: T0 }, T0)
}

describe('projectFolder', () => {
  test('opens a folder an agent reported working in', () => {
    reported(dir)

    expect(projectFolder(db, dir)).toBe(dir)
  })

  test('refuses a folder no agent reported, even when it exists', () => {
    expect(projectFolder(db, dir)).toBeNull()
  })

  test('refuses a reported folder that was deleted since', () => {
    const gone = join(dir, 'gone')
    reported(gone)

    expect(projectFolder(db, gone)).toBeNull()
  })

  test('never opens a file, so a reported path cannot start a program', () => {
    const file = join(dir, 'run.cmd')
    writeFileSync(file, 'echo hi')
    reported(file)

    expect(projectFolder(db, file)).toBeNull()
  })

  test('refuses anything that is not an absolute path', () => {
    reported('perch')

    expect(projectFolder(db, 'perch')).toBeNull()
    expect(projectFolder(db, 42)).toBeNull()
    expect(projectFolder(db, '')).toBeNull()
  })
})

const PERCH = 'D:\\code\\perch'
const BLOG = 'D:\\code\\blog'
const ev = (agent: string, sessionId: string, cwd: string | undefined, status: 'running' | 'done', t: number, title?: string): void => {
  applyAgentEvent(db, { v: 1, agent, sessionId, status, cwd, title, at: t }, t)
}

describe('listProjects', () => {
  test('one per folder, with its latest session, how many and since when, newest first', () => {
    ev('codex', 'a', PERCH, 'running', T0, '做浮窗')
    ev('codex', 'a', PERCH, 'done', T0 + 10)
    ev('claude-code', 'b', PERCH, 'running', T0 + 20, '做專案頁')
    ev('claude-code', 'c', BLOG, 'done', T0 + 5, '修 RSS')
    ev('grok-build', 'd', undefined, 'done', T0 + 30)

    const projects = listProjects(db)

    expect(projects.map((p) => [p.name, p.sessionCount, p.firstAt, p.lastAt, p.latest.title])).toEqual([
      ['perch', 2, T0, T0 + 20, '做專案頁'],
      ['blog', 1, T0 + 5, T0 + 5, '修 RSS'],
    ])
  })

  test('counts the open work of each project, not finished work or steps', () => {
    ev('codex', 'a', PERCH, 'done', T0)
    const task = createItem(db, { kind: 'task', title: '更新 README', project: PERCH }, T0)
    createItem(db, { kind: 'task', title: 'a step', parentId: task.id, project: PERCH }, T0)
    const done = createItem(db, { kind: 'idea', title: 'done', project: PERCH }, T0)
    completeItem(db, done.id, T0 + 1)

    expect(listProjects(db)[0].openItems).toBe(1)
  })

  test('a project marked 不再列出 stays known but hidden, until shown again', () => {
    ev('codex', 'a', PERCH, 'done', T0)
    setProjectHidden(db, PERCH, true)
    expect(listProjects(db)[0].hidden).toBe(true)

    setProjectHidden(db, PERCH, false)
    expect(listProjects(db)[0].hidden).toBe(false)
  })
})

describe('projectDetail', () => {
  test('the latest sessions and the open work of one folder', () => {
    ev('codex', 'a', PERCH, 'done', T0, '一')
    ev('codex', 'b', PERCH, 'done', T0 + 1, '二')
    ev('codex', 'c', BLOG, 'done', T0 + 2, '別的專案')
    createItem(db, { kind: 'idea', title: '更新 README', project: PERCH }, T0)
    createItem(db, { kind: 'idea', title: '不相干', project: BLOG }, T0)

    const detail = projectDetail(db, PERCH)

    expect(detail?.sessions.map((s) => s.title)).toEqual(['二', '一'])
    expect(detail?.items.map((i) => i.title)).toEqual(['更新 README'])
  })

  test('nothing for a folder no agent reported', () => {
    expect(projectDetail(db, 'D:\\nowhere')).toBeNull()
  })
})

describe('captureForProject', () => {
  const NOW = new Date(2026, 9, 1, 10).getTime()

  test('a dated line becomes the project’s task; an undated one its idea', () => {
    ev('codex', 'a', PERCH, 'done', T0)

    expect(captureForProject(db, '明天 更新 README', PERCH, NOW, DEFAULT_SETTINGS)).toMatchObject({
      kind: 'task',
      title: '更新 README',
      project: PERCH,
    })
    expect(captureForProject(db, '補測試', PERCH, NOW, DEFAULT_SETTINGS)).toMatchObject({
      kind: 'idea',
      dueAt: null,
      project: PERCH,
    })
  })

  test('refuses a folder no agent reported', () => {
    expect(() => captureForProject(db, '補測試', 'D:\\nowhere', NOW, DEFAULT_SETTINGS)).toThrow()
  })
})
