import type { AgentSession } from './types'

/**
 * How the computer last went down, read from the Windows event log:
 * - crash: it stopped without shutting down (Kernel-Power 41, EventLog 6008): a hang, a reset, power loss
 * - program: an installer or Windows Update restarted it
 * - you: 關機 or 重新啟動 from the Start menu (or the desktop's Alt+F4 dialog)
 * - command: someone ran `shutdown` (a script, an agent, Perch's own shutdown timer)
 * - signout: the person signed out of Windows and back in
 * - unknown: a restart with nothing in the log to explain it
 */
export type RestartKind = 'crash' | 'program' | 'you' | 'command' | 'signout' | 'unknown'

export interface RestartInfo {
  readonly kind: RestartKind
  /** The shutdown's time; for a crash, the boot after it; for a sign-out, the new sign-in. */
  readonly at: number
  /** The program that shut down or restarted the computer ("msiexec.exe"), when the log names one. */
  readonly by: string | null
  /** The note left with `shutdown /c`. */
  readonly note: string | null
  /** A restart rather than a power off. */
  readonly restart: boolean
}

/** Nobody chose to close these sessions, so every one that was open gets checked for reopening. */
export const preChecked = (kind: RestartKind | undefined): boolean => kind === 'crash' || kind === 'program'

const pad = (n: number): string => String(n).padStart(2, '0')

/** "10/12 03:34" in local time. */
export function clockLabel(at: number): string {
  const d = new Date(at)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Installers by the name a person knows them by. */
function programLabel(by: string | null): string {
  if (!by) return '有程式'
  if (/^(TrustedInstaller|MoUsoCoreWorker|UsoClient|wuauclt|musnotification)\.exe$/i.test(by)) return 'Windows 更新'
  if (/^msiexec\.exe$/i.test(by)) return '安裝程式'
  return by
}

/** The notification's title (and the Agent tab's line) for `count` sessions cut off by `info`. */
export function restartTitle(info: RestartInfo | null, count: number): string {
  switch (info?.kind) {
    case 'crash':
      return `電腦當機重開了，${count} 個 session 被中斷`
    case 'program':
      return `${programLabel(info.by)}重開了電腦，${count} 個 session 被中斷`
    case 'signout':
      return `登出前還有 ${count} 個 session 開著`
    default:
      return `關機前還有 ${count} 個 session 開著`
  }
}

/** When and how, in a few words, under the Agent tab's line ("10/12 03:34 你自己關機的"). */
export function restartWhen(info: RestartInfo): string {
  const when = clockLabel(info.at)
  switch (info.kind) {
    case 'crash':
      return `${when} 重新開機`
    case 'program':
      return `${when} · ${programLabel(info.by)}`
    case 'you':
      return `${when} 你自己${info.restart ? '重新開機' : '關機'}的`
    case 'command':
      return `${when} 關機指令${info.note ? `：${info.note.slice(0, 40)}` : ''}`
    case 'signout':
      return `${when} 重新登入`
    case 'unknown':
      return `${when} 重新開機`
  }
}

/** One sentence on what happened and what is checked, for the top of the reopen window. */
export function restartLine(info: RestartInfo, count: number): string {
  const when = clockLabel(info.at)
  const rest = `那時還有 ${count} 個開著，要接回哪些自己勾。`
  switch (info.kind) {
    case 'crash':
      return `電腦當機了，${when} 重新開機。當時還開著的先幫你勾好了。`
    case 'program':
      return `${programLabel(info.by)}在 ${when} 重開了電腦。當時還開著的先幫你勾好了。`
    case 'you':
      return `你 ${when} 從開始選單${info.restart ? '重新開機' : '關機'}，${rest}`
    case 'command': {
      const note = info.note ? `（「${info.note.slice(0, 60)}」）` : ''
      return `${when} 有程式下了${info.restart ? '重開' : '關機'}指令${note}，${rest}`
    }
    case 'signout':
      return `你登出過 Windows，${when} 重新登入。${rest}`
    case 'unknown':
      return `電腦 ${when} 重新開機，${rest}`
  }
}

export interface RestoreCandidate {
  readonly session: AgentSession
  /** Its folder is gone, so it cannot be reopened. */
  readonly gone: boolean
}

/** What the reopen window lists. */
export interface RestoreList {
  /** How the computer last went down; null when no session was cut off by it. */
  readonly restart: RestartInfo | null
  /** Open in a terminal when the computer went down, not handled yet, newest first. */
  readonly interrupted: readonly RestoreCandidate[]
  /** Used within the range and not open now (closed ones, older cut-off ones), newest first. */
  readonly others: readonly RestoreCandidate[]
  /** The interrupted ones start checked (a crash or an installer closed them, not the person). */
  readonly preChecked: boolean
  readonly rangeHours: number
  /** Sessions that last reported before this lost their terminal (the last restart or sign-in). */
  readonly cutoffAt: number
}

/** The Agent tab's view of it: a line after a restart, and whether reopening exists at all. */
export interface RestoreSummary {
  readonly restart: RestartInfo | null
  /** Sessions cut off by the last restart that are still waiting to be reopened or skipped. */
  readonly interrupted: number
}

/** The two ranges the window offers: the default, and 再早一點. */
export const RESTORE_RANGES_HOURS = [12, 72] as const
