import { describe, expect, test } from 'vitest'
import { classifyRestart, exeName, parseShutdownEvents, type ShutdownEvent } from './restartKind'

const MIN = 60_000
const BOOT = 1_800_000_000_000
const SIGN_IN = BOOT + 25_000
const LAST = BOOT - 3 * 60 * MIN

const asked = (at: number, process: string, type = '電源關閉', note = ''): ShutdownEvent => ({ id: 1074, at, process, type, note })
const unclean = (id: number, at: number): ShutdownEvent => ({ id, at, process: '', type: '', note: '' })
const START_MENU = 'C:\\WINDOWS\\SystemApps\\Microsoft.Windows.StartMenuExperienceHost_cw5n1h2txyewy\\StartMenuExperienceHost.exe (PC-NAME)'

describe('parseShutdownEvents', () => {
  test('reads the array PowerShell prints, and a single object it unwrapped', () => {
    const one = '{"id":1074,"at":1791696848000,"process":"msiexec.exe","type":"重新啟動","note":" Adobe "}'
    expect(parseShutdownEvents(`[${one},{"id":41,"at":1791697000000,"process":"","type":"","note":""}]`)).toHaveLength(2)
    expect(parseShutdownEvents(one)).toEqual([{ id: 1074, at: 1791696848000, process: 'msiexec.exe', type: '重新啟動', note: 'Adobe' }])
  })

  test('nothing usable gives an empty list', () => {
    expect(parseShutdownEvents('')).toEqual([])
    expect(parseShutdownEvents('not json')).toEqual([])
    expect(parseShutdownEvents('[{"id":"41"},{"at":5},null]')).toEqual([])
  })
})

describe('exeName', () => {
  test('the program without its folder or the computer name', () => {
    expect(exeName(START_MENU)).toBe('StartMenuExperienceHost.exe')
    expect(exeName('msiexec.exe')).toBe('msiexec.exe')
    expect(exeName('')).toBeNull()
  })
})

describe('classifyRestart', () => {
  test('Kernel-Power 41 or 6008 after the sessions were last seen: a crash, dated at the boot', () => {
    const events = [unclean(41, BOOT + 13_000), unclean(6008, BOOT + 25_000)]
    expect(classifyRestart(events, LAST, BOOT, SIGN_IN)).toMatchObject({ kind: 'crash', at: BOOT })
  })

  test('the Start menu: the person shut down (or restarted) themselves', () => {
    expect(classifyRestart([asked(BOOT - 3 * 60 * MIN + MIN, START_MENU)], LAST, BOOT, SIGN_IN)).toMatchObject({
      kind: 'you',
      at: BOOT - 3 * 60 * MIN + MIN,
      restart: false,
    })
    expect(classifyRestart([asked(BOOT - MIN, START_MENU, '重新啟動')], LAST, BOOT, SIGN_IN)).toMatchObject({ kind: 'you', restart: true })
  })

  test('shutdown.exe: a command (a script, an agent, the shutdown timer), with its note', () => {
    const e = asked(BOOT - MIN, 'C:\\WINDOWS\\System32\\shutdown.exe (PC)', '關機', 'nightly render finished')
    expect(classifyRestart([e], LAST, BOOT, SIGN_IN)).toMatchObject({ kind: 'command', note: 'nightly render finished', by: 'shutdown.exe' })
  })

  test('an installer or Windows Update: a program restarted it', () => {
    expect(classifyRestart([asked(BOOT - MIN, 'msiexec.exe', '重新啟動')], LAST, BOOT, SIGN_IN)).toMatchObject({ kind: 'program', by: 'msiexec.exe' })
    expect(classifyRestart([asked(BOOT - MIN, 'C:\\WINDOWS\\servicing\\TrustedInstaller.exe (PC)', '重新啟動')], LAST, BOOT, SIGN_IN)).toMatchObject({
      kind: 'program',
      by: 'TrustedInstaller.exe',
    })
  })

  test('the sign-in screen and Ctrl+Alt+Del are the person too', () => {
    expect(classifyRestart([asked(BOOT - MIN, 'C:\\Windows\\System32\\winlogon.exe (PC)')], LAST, BOOT, SIGN_IN).kind).toBe('you')
    expect(classifyRestart([asked(BOOT - MIN, 'C:\\Windows\\System32\\LogonUI.exe (PC)')], LAST, BOOT, SIGN_IN).kind).toBe('you')
  })

  test('a hook that still reported while Windows was shutting down does not hide the shutdown', () => {
    const shutdownAt = BOOT - 60 * MIN
    expect(classifyRestart([asked(shutdownAt, START_MENU)], shutdownAt + 2 * MIN, BOOT, SIGN_IN).kind).toBe('you')
  })

  test('a shutdown that never finished counts as a crash', () => {
    expect(classifyRestart([asked(BOOT - MIN, START_MENU), unclean(6008, BOOT + 25_000)], LAST, BOOT, SIGN_IN).kind).toBe('crash')
  })

  test('events from before the sessions were last seen explain nothing', () => {
    const old = [unclean(41, LAST - 60 * MIN), asked(LAST - 30 * MIN, START_MENU)]
    expect(classifyRestart(old, LAST, BOOT, SIGN_IN).kind).toBe('unknown')
  })

  test('a sign-in long after the boot with nothing in the log: the person signed out and back in', () => {
    const later = BOOT + 3 * 60 * MIN
    expect(classifyRestart([], BOOT + 60 * MIN, BOOT, later)).toMatchObject({ kind: 'signout', at: later })
  })
})
