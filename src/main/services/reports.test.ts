import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { applyAgentEvent } from '../db/agents'
import { openDatabase } from '../db/connection'
import { reportFileOf } from '../db/reportFiles'
import { rememberReportFile } from '../db/reportFiles'
import { briefingNotePath, notePathFor, notesFolder, samePath, writeIfChanged, writePdfFile } from './reports'
import { yaml } from './reportNote'
import { saveSessionNote } from './saveReports'

let dir: string
let db: DatabaseSync
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'perch-reports-'))
  db = openDatabase(':memory:')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const note = (sessionId: string): string => `---\nsession: ${JSON.stringify(sessionId)}\n---\nbody\n`

describe('folders', () => {
  test('notes go into the vault’s Perch/報告, else output/reports in the data folder', () => {
    expect(notesFolder('D:\\vault', 'C:\\data')).toBe(join('D:\\vault', 'Perch', '報告'))
    expect(notesFolder(null, 'C:\\data')).toBe(join('C:\\data', 'output', 'reports'))
    expect(briefingNotePath('D:\\vault', 'C:\\data', '2026-11-11')).toBe(join('D:\\vault', 'Perch', '簡報', '2026-11-11.md'))
    expect(briefingNotePath(null, 'C:\\data', '2026-11-11')).toBe(join('C:\\data', 'output', 'reports', '簡報 2026-11-11.md'))
  })
})

describe('notePathFor', () => {
  test('the same session rewrites its own file; another session with the same date and name gets _2, then _3', () => {
    expect(notePathFor(dir, '2026-11-11 報告', 'a', null)).toBe(join(dir, '2026-11-11 報告.md'))
    writeFileSync(join(dir, '2026-11-11 報告.md'), note('a'))
    expect(notePathFor(dir, '2026-11-11 報告', 'a', null)).toBe(join(dir, '2026-11-11 報告.md'))
    expect(notePathFor(dir, '2026-11-11 報告', 'b', null)).toBe(join(dir, '2026-11-11 報告_2.md'))
    writeFileSync(join(dir, '2026-11-11 報告_2.md'), note('b'))
    expect(notePathFor(dir, '2026-11-11 報告', 'b', null)).toBe(join(dir, '2026-11-11 報告_2.md'))
    expect(notePathFor(dir, '2026-11-11 報告', 'c', null)).toBe(join(dir, '2026-11-11 報告_3.md'))
  })

  test('a file someone wrote by hand under that name is never taken over', () => {
    writeFileSync(join(dir, 'x.md'), '# my own note\n')
    expect(notePathFor(dir, 'x', 'a', null)).toBe(join(dir, 'x_2.md'))
  })
})

describe('notes keep their own file (item 4)', () => {
  test('the stored note wins when the name changes, so no second file appears', () => {
    writeFileSync(join(dir, 'old name.md'), note('a'))
    expect(notePathFor(dir, 'new name', 'a', join(dir, 'old name.md'))).toBe(join(dir, 'old name.md'))
  })

  test('the stored note is not used once it is gone, in another folder, or names another session', () => {
    writeFileSync(join(dir, 'theirs.md'), note('b'))
    expect(notePathFor(dir, 'n', 'a', join(dir, 'gone.md'))).toBe(join(dir, 'n.md'))
    expect(notePathFor(dir, 'n', 'a', join(dir, 'theirs.md'))).toBe(join(dir, 'n.md'))
    expect(notePathFor(join(dir, 'other'), 'n', 'a', join(dir, 'theirs.md'))).toBe(join(dir, 'other', 'n.md'))
  })

  test('front matter rewritten bare or single-quoted (as Obsidian may) still names the session', () => {
    writeFileSync(join(dir, 'bare.md'), '---\nsession: claude-code:a\n---\n')
    writeFileSync(join(dir, 'single.md'), "---\nsession: 'claude-code:a'\n---\n")
    writeFileSync(join(dir, 'comment.md'), '---\nsession: claude-code:a # mine\n---\n')
    expect(notePathFor(dir, 'bare', 'claude-code:a', null)).toBe(join(dir, 'bare.md'))
    expect(notePathFor(dir, 'single', 'claude-code:a', null)).toBe(join(dir, 'single.md'))
    expect(notePathFor(dir, 'comment', 'claude-code:a', null)).toBe(join(dir, 'comment.md'))
  })

  test('only a session key inside the front matter counts, never one forged inside another value', () => {
    writeFileSync(join(dir, 'forged.md'), '---\nfolder: "C:\\x\u2028session: \\"claude-code:a\\""\nsession: "claude-code:b"\n---\n')
    writeFileSync(join(dir, 'body.md'), '# no front matter\nsession: "claude-code:a"\n')
    expect(notePathFor(dir, 'forged', 'claude-code:a', null)).toBe(join(dir, 'forged_2.md'))
    expect(notePathFor(dir, 'body', 'claude-code:a', null)).toBe(join(dir, 'body_2.md'))
  })

  test('yaml() escapes every line break, U+2028 and U+2029 included', () => {
    expect(yaml('a\nb\rc\u2028d\u2029e\u0085f')).toBe('"a\\nb\\rc\\u2028d\\u2029e\\u0085f"')
    expect(yaml(3)).toBe('3')
  })
})

describe('writePdfFile (item 5)', () => {
  const pdf = (text: string): Uint8Array => new TextEncoder().encode(text)
  const save = (sessionId: string, text: string, folder = dir): string => {
    const file = writePdfFile(db, folder, 'r', sessionId, pdf(text))
    rememberReportFile(db, 'pdf', sessionId, file)
    return file
  }

  test('two sessions with the same name never share a file, and a re-save rewrites only its own', () => {
    const a = save('a', 'one')
    const b = save('b', 'two')
    const again = save('a', 'three')

    expect([a, b, again]).toEqual([join(dir, 'r.pdf'), join(dir, 'r_2.pdf'), join(dir, 'r.pdf')])
    expect(readFileSync(b, 'utf8')).toBe('two')
    expect(readFileSync(a, 'utf8')).toBe('three')
  })

  test('a file nobody recorded is never overwritten', () => {
    writeFileSync(join(dir, 'r.pdf'), 'by hand')
    expect(save('a', 'pdf')).toBe(join(dir, 'r_2.pdf'))
    expect(readFileSync(join(dir, 'r.pdf'), 'utf8')).toBe('by hand')
  })

  test('a name still recorded for another session is not taken, even when its file was deleted', () => {
    const a = save('a', 'a1')
    rmSync(a)

    expect(save('b', 'b1')).toBe(join(dir, 'r_2.pdf'))
    expect(save('a', 'a2')).toBe(a)
  })

  test('a re-save never overwrites a file that now belongs to another session', () => {
    const a = save('a', 'a1')
    rememberReportFile(db, 'pdf', 'b', a)
    writeFileSync(a, 'b1')

    const again = save('a', 'a2')

    expect(again).toBe(join(dir, 'r_2.pdf'))
    expect(readFileSync(a, 'utf8')).toBe('b1')
  })

  test('folders compare resolved, and without case on Windows', () => {
    expect(samePath(join(dir, 'x', '..', 'y'), join(dir, 'y'))).toBe(true)
    expect(samePath(join(dir, 'Y'), join(dir, 'y'))).toBe(process.platform === 'win32')
  })
})

describe('writeIfChanged', () => {
  test('creates folders, writes once, and leaves an unchanged file alone', () => {
    const file = join(dir, 'a', 'b', 'n.md')
    expect(writeIfChanged(file, 'one')).toBe(true)
    const first = statSync(file).mtimeMs
    expect(writeIfChanged(file, 'one')).toBe(false)
    expect(statSync(file).mtimeMs).toBe(first)
    expect(writeIfChanged(file, 'two')).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('two')
  })
})

describe('saveSessionNote', () => {
  const report = (id: string, name: string): void => {
    applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: id, status: 'running', name, prompt: '做一件事', at: 1_800_000_000_000 }, 1_800_000_000_000)
    applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: id, status: 'done', reply: '做好了', at: 1_800_000_060_000 }, 1_800_000_060_000)
  }
  const place = { obsidianDir: null, dataDir: '', dayStartHour: 4 }

  test('writes the note, finds it again, and gives a same-named session its own file', () => {
    report('s1', '同名')
    report('s2', '同名')
    const at = { ...place, dataDir: dir }

    const first = saveSessionNote(db, 'claude-code:s1', at)
    const again = saveSessionNote(db, 'claude-code:s1', at)
    const other = saveSessionNote(db, 'claude-code:s2', at)

    expect(first.written).toBe(true)
    expect(again).toEqual({ path: first.path, written: false })
    expect(other.path).toBe(first.path.replace(/\.md$/, '_2.md'))
    expect(readFileSync(first.path, 'utf8')).toContain('做好了')
    expect(reportFileOf(db, 'note', 'claude-code:s2')).toBe(other.path)
  })

  test('a session that gets its name later, or a changed day start, keeps writing the one file it has', () => {
    report('s1', '先叫這個')
    const at = { ...place, dataDir: dir }
    const first = saveSessionNote(db, 'claude-code:s1', at)
    applyAgentEvent(db, { v: 1, agent: 'claude-code', sessionId: 's1', status: 'done', name: '後來改名', at: 1_800_000_120_000 }, 1_800_000_120_000)

    const renamed = saveSessionNote(db, 'claude-code:s1', at)
    const otherDayStart = saveSessionNote(db, 'claude-code:s1', { ...at, dayStartHour: 0 })

    expect(renamed.path).toBe(first.path)
    expect(otherDayStart.path).toBe(first.path)
    expect(readFileSync(first.path, 'utf8')).toContain('# 後來改名')
    expect(readdirSync(join(dir, 'output', 'reports'))).toHaveLength(1)
  })

  test('an Obsidian folder that is gone fails loudly here (the caller reports it), and writes nothing elsewhere', () => {
    report('s1', 'x')
    const gone = join(dir, 'missing-drive\u0000')
    expect(() => saveSessionNote(db, 'claude-code:s1', { ...place, obsidianDir: gone, dataDir: dir })).toThrow()
    expect(existsSync(join(dir, 'output'))).toBe(false)
  })
})
