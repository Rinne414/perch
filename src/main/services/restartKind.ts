import type { RestartInfo, RestartKind } from '@shared/restore'

/** One entry of the Windows System log: 41 / 6008 (unclean shutdown) or 1074 (a shutdown someone asked for). */
export interface ShutdownEvent {
  readonly id: number
  /** Epoch milliseconds. */
  readonly at: number
  /** 1074 only: "C:\…\StartMenuExperienceHost.exe (PC-NAME)" or "msiexec.exe". */
  readonly process: string
  /** 1074 only: "電源關閉", "重新啟動", "power off", "restart"… (in the Windows display language). */
  readonly type: string
  /** 1074 only: the comment given with `shutdown /c`. */
  readonly note: string
}

const UNCLEAN = new Set([41, 6008])
const ASKED = 1074
/** Windows writes 41 and 6008 at the next boot, some seconds after it starts. */
const CRASH_LOG_DELAY_MS = 10 * 60_000
/** Hooks can still report while Windows is shutting down, after the shutdown was asked for. */
const SHUTDOWN_REPORT_SLACK_MS = 5 * 60_000
/** A sign-in this long after the boot means the person signed out and back in, not just a slow login. */
const SIGN_OUT_GAP_MS = 5 * 60_000

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The JSON the event-log query prints (an array, or one object when PowerShell unwraps it); bad entries are dropped. */
export function parseShutdownEvents(stdout: string): ShutdownEvent[] {
  let raw: unknown
  try {
    raw = JSON.parse(stdout.trim() || '[]')
  } catch {
    return []
  }
  const list = Array.isArray(raw) ? raw : [raw]
  return list.flatMap((r): ShutdownEvent[] => {
    if (typeof r !== 'object' || r === null) return []
    const o = r as Record<string, unknown>
    const id = o['id']
    const at = o['at']
    if (typeof id !== 'number' || typeof at !== 'number' || !Number.isFinite(at)) return []
    return [{ id, at, process: text(o['process']), type: text(o['type']), note: text(o['note']).trim() }]
  })
}

/** "C:\WINDOWS\System32\shutdown.exe (PC-NAME)" → "shutdown.exe". */
export function exeName(process: string): string | null {
  const path = process.replace(/\s+\([^)]*\)\s*$/, '').trim()
  const name = path.split(/[\\/]/).at(-1)
  return name ? name : null
}

function whoAsked(exe: string | null): RestartKind {
  // The Start menu, the desktop's Alt+F4 dialog, the Ctrl+Alt+Del and sign-in screens.
  if (exe && /^(StartMenuExperienceHost|explorer|ShellExperienceHost|ShellHost|RuntimeBroker|winlogon|LogonUI)\.exe$/i.test(exe)) return 'you'
  if (exe && /^shutdown\.exe$/i.test(exe)) return 'command'
  return 'program'
}

/**
 * Why the sessions last seen at `lastActive` lost their terminals before `cutoffAt` (the boot,
 * or the sign-in after it). Only events between the two count, so an old crash cannot explain
 * a later sign-out. An unclean shutdown wins over a requested one: the request never finished.
 */
export function classifyRestart(events: readonly ShutdownEvent[], lastActive: number, bootAt: number, cutoffAt: number): RestartInfo {
  const between = events.filter((e) => e.at >= lastActive - SHUTDOWN_REPORT_SLACK_MS && e.at <= cutoffAt + CRASH_LOG_DELAY_MS)
  if (between.some((e) => UNCLEAN.has(e.id))) return { kind: 'crash', at: bootAt, by: null, note: null, restart: true }
  const asked = between.filter((e) => e.id === ASKED && e.at <= cutoffAt).sort((a, b) => b.at - a.at)[0]
  if (asked) {
    const by = exeName(asked.process)
    return {
      kind: whoAsked(by),
      at: asked.at,
      by,
      note: asked.note || null,
      restart: /restart|重新啟動|重新開機|重開/i.test(asked.type),
    }
  }
  if (cutoffAt - bootAt > SIGN_OUT_GAP_MS) return { kind: 'signout', at: cutoffAt, by: null, note: null, restart: false }
  return { kind: 'unknown', at: bootAt, by: null, note: null, restart: true }
}
