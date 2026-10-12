import { describe, expect, test } from 'vitest'
import { preChecked, restartLine, restartTitle, restartWhen, type RestartInfo } from './restore'

const AT = new Date(2026, 9, 12, 3, 34).getTime()
const info = (over: Partial<RestartInfo>): RestartInfo => ({ kind: 'you', at: AT, by: null, note: null, restart: false, ...over })

describe('preChecked', () => {
  test('only when nobody chose to close the sessions', () => {
    expect(preChecked('crash')).toBe(true)
    expect(preChecked('program')).toBe(true)
    expect(preChecked('you')).toBe(false)
    expect(preChecked('command')).toBe(false)
    expect(preChecked('signout')).toBe(false)
    expect(preChecked(undefined)).toBe(false)
  })
})

describe('restartTitle', () => {
  test('says how the sessions were lost', () => {
    expect(restartTitle(info({ kind: 'crash' }), 3)).toBe('電腦當機重開了，3 個 session 被中斷')
    expect(restartTitle(info({ kind: 'program', by: 'TrustedInstaller.exe' }), 2)).toBe('Windows 更新重開了電腦，2 個 session 被中斷')
    expect(restartTitle(info({}), 2)).toBe('關機前還有 2 個 session 開著')
    expect(restartTitle(info({ kind: 'signout' }), 1)).toBe('登出前還有 1 個 session 開著')
    expect(restartTitle(null, 4)).toBe('關機前還有 4 個 session 開著')
  })
})

describe('restartLine', () => {
  test('names the time, and who chose', () => {
    expect(restartLine(info({}), 2)).toBe('你 10/12 03:34 從開始選單關機，那時還有 2 個開著，要接回哪些自己勾。')
    expect(restartLine(info({ restart: true }), 2)).toContain('從開始選單重新開機')
    expect(restartLine(info({ kind: 'crash' }), 3)).toBe('電腦當機了，10/12 03:34 重新開機。當時還開著的先幫你勾好了。')
    expect(restartLine(info({ kind: 'command', note: 'overnight run finished' }), 1)).toContain('（「overnight run finished」）')
    expect(restartLine(info({ kind: 'program', by: 'msiexec.exe' }), 1)).toContain('安裝程式在 10/12 03:34 重開了電腦')
  })
})

describe('restartWhen', () => {
  test('a few words under the Agent tab line', () => {
    expect(restartWhen(info({}))).toBe('10/12 03:34 你自己關機的')
    expect(restartWhen(info({ kind: 'crash' }))).toBe('10/12 03:34 重新開機')
  })
})
