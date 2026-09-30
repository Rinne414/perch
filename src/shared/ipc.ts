import type { DayMarks, DayView } from './calendar'
import type { IntegrationsPayload } from './integrations'
import type { MainView } from './mainView'
import type { NowView } from './now'
import type { QuotaSnapshot, QuotaWindow } from './quota'
import type { Recap } from './recap'
import type { AgentSession, Item, RoutineSchedule } from './types'

/** Where a captured line goes when it carries no date. */
export type CaptureTarget = 'today' | 'inbox'

export type MainTab = 'today' | 'inbox' | 'agents' | 'routines' | 'calendar' | 'settings'
export const MAIN_TABS: readonly MainTab[] = ['today', 'inbox', 'agents', 'routines', 'calendar', 'settings']

/** "不排" moves a planned item back to the inbox (unless it has a deadline). */
export type PlanTarget = 'today' | 'tomorrow' | 'none'

export type WindowAction = 'minimize' | 'maximize' | 'close'

/** What to do with several past-due items at once. "drop" = 不做了. */
export type BatchTarget = 'today' | 'tomorrow' | 'none' | 'drop'

/** "先做 5 分鐘": the one timer that may be running. */
export interface FocusState {
  readonly itemId: string
  /** The next step it started on; null when the task had no steps. */
  readonly stepId: string | null
  readonly title: string
  readonly startedAt: number
  /** Chose "繼續" at five minutes: keep counting up, no more question. */
  readonly extended: boolean
}

export interface NowPayload {
  readonly view: NowView
  readonly recap: Recap | null
  readonly pinned: boolean
  readonly dayStartHour: number
  readonly focus: FocusState | null
  /** Claude Code's 5-hour window once it is nearly used up; null otherwise. */
  readonly quotaAlert: QuotaWindow | null
}

export interface MainPayload {
  readonly view: MainView
  readonly attention: readonly AgentSession[]
  /** Sessions still working, most recently active first. */
  readonly running: readonly AgentSession[]
  /** Everything else from the last week (finished, failed, stopped, already seen), newest first. */
  readonly recentAgents: readonly AgentSession[]
  readonly dayStartHour: number
  /** Days untouched before an undated item moves to "舊的". */
  readonly staleDays: number
  readonly focus: FocusState | null
  /** Claude Code's usage limits, only windows that have not reset yet; null when none are known. */
  readonly quota: QuotaSnapshot | null
}

/** How much the glass tints what is behind it: 淡 / 中 / 濃. */
export type GlassLevel = 'light' | 'mid' | 'dense'
export const GLASS_LEVELS: readonly GlassLevel[] = ['light', 'mid', 'dense']

export interface AppInfo {
  readonly version: string
  readonly dataDir: string
  readonly openAtLogin: boolean
  /** Only an installed copy can start with Windows; a development run cannot. */
  readonly canOpenAtLogin: boolean
  readonly glass: GlassLevel
  /** Electron accelerator of the quick-capture shortcut, e.g. "Control+Alt+N". */
  readonly captureShortcut: string
  /** When the newest backup copy of the database was taken; null before the first one. */
  readonly lastBackupAt: number | null
  /** Where the daily Obsidian notes go (inside its Perch/ folder); null when off. */
  readonly obsidianDir: string | null
}

/** Folders the settings page can open in Explorer. */
export type AppFolder = 'data' | 'backups' | 'logs'
export const APP_FOLDERS: readonly AppFolder[] = ['data', 'backups', 'logs']

/**
 * The update row in 設定. Nothing goes online until the person presses 檢查更新;
 * a newer version then downloads by itself and waits for 重開更新 (or installs when Perch quits).
 */
export type UpdateStatus =
  | { readonly state: 'idle' }
  /** A development run: there is nothing to update. */
  | { readonly state: 'unavailable' }
  | { readonly state: 'checking' }
  | { readonly state: 'latest' }
  | { readonly state: 'downloading'; readonly version: string; readonly percent: number }
  | { readonly state: 'ready'; readonly version: string }
  /** A newer version this system cannot install by itself (macOS without signing, a Linux .deb): download it by hand. */
  | { readonly state: 'manual'; readonly version: string }
  | { readonly state: 'error'; readonly message: string }

/** Where an export was written. */
export interface ExportResult {
  readonly folder: string
  readonly files: readonly string[]
}

export interface RoutineRecord {
  /** Timeline event id, used to take a wrong record back. */
  readonly id: number
  readonly at: number
  /** Recorded afterwards ("I did it yesterday") rather than checked off at the time. */
  readonly backfilled: boolean
}

export interface RoutineHistory {
  /** Newest first. */
  readonly records: readonly RoutineRecord[]
  /** Average days between completions; null until there are three records. */
  readonly averageDays: number | null
}

/** Everything the renderer may ask of the main process. Exposed as `window.api`. */
export interface Api {
  getNow(): Promise<NowPayload>
  getMain(): Promise<MainPayload>
  capture(text: string, target: CaptureTarget): Promise<Item>
  complete(id: string): Promise<void>
  reopen(id: string): Promise<void>
  postpone(id: string): Promise<void>
  plan(id: string, target: PlanTarget): Promise<void>
  /** Parses a date out of `text`; null clears the deadline. */
  setDue(id: string, text: string | null): Promise<void>
  rename(id: string, title: string): Promise<void>
  /** "不做了": closes it without counting it as done; `reopen` picks it back up. */
  drop(id: string): Promise<void>
  /** Several past-due items at once; returns a token for `undoBatch` (valid for a minute). */
  rescheduleOverdue(ids: readonly string[], target: BatchTarget): Promise<string>
  undoBatch(token: string): Promise<boolean>
  /** Deletes an item and its steps; `undoRemove` brings it back for a minute. */
  remove(id: string): Promise<void>
  undoRemove(id: string): Promise<boolean>
  addStep(parentId: string, title: string): Promise<void>
  /** A null interval makes a tracker that only remembers when it last happened. */
  createRoutine(title: string, intervalDays: number | null, schedule?: RoutineSchedule | null): Promise<void>
  updateRoutine(id: string, title: string, intervalDays: number | null, schedule?: RoutineSchedule | null): Promise<void>
  getRoutineHistory(id: string): Promise<RoutineHistory>
  /** Records a completion from typed text ("昨天", "前天晚上"). */
  recordRoutine(id: string, when: string): Promise<void>
  removeRoutineRecord(recordId: number): Promise<void>
  startFocus(itemId: string, stepId: string | null): Promise<void>
  extendFocus(): Promise<void>
  /** Returns the whole minutes that were logged (0 when under a minute). */
  stopFocus(): Promise<number>
  /** Marks for every day from `from` to `to` (YYYY-MM-DD, inclusive, at most 60 days). */
  getMonth(from: string, to: string): Promise<DayMarks[]>
  getDay(day: string): Promise<DayView>
  /** A line typed on a calendar day: planned for that day unless it names its own date. */
  captureOn(text: string, day: string): Promise<void>
  /** Fills in something that happened on a past day ("下午3點 開會"). */
  addManualEntry(day: string, text: string): Promise<void>
  removeManualEntry(entryId: number): Promise<void>
  /** Saves the day's note (the diary); an empty text removes it. */
  setDayNote(day: string, text: string): Promise<void>
  acknowledgeAgents(ids: readonly string[]): Promise<void>
  dismissRecap(): Promise<void>
  getIntegrations(): Promise<IntegrationsPayload>
  /** Installs (on = true) or removes an agent's hook; returns the fresh state. */
  setHook(agent: string, on: boolean): Promise<IntegrationsPayload>
  /** Deletes everything one agent wrote; returns how many rows went. */
  clearAgentData(agent: string): Promise<number>
  /** Installs (on = true) or removes Claude Code's status line that reports its usage limits. */
  setStatusline(on: boolean): Promise<IntegrationsPayload>
  getAppInfo(): Promise<AppInfo>
  setOpenAtLogin(on: boolean): Promise<AppInfo>
  setGlass(level: GlassLevel): Promise<AppInfo>
  /** Moves the quick-capture shortcut; null (and the old one kept) when another program holds the new one. */
  setCaptureShortcut(accelerator: string): Promise<AppInfo | null>
  openFolder(folder: AppFolder): void
  /** Asks for a folder and writes a JSON and a Markdown copy of everything; null when cancelled. */
  exportData(): Promise<ExportResult | null>
  /** Asks for an Obsidian folder, then writes the last 30 days into its Perch/ folder; null when cancelled. */
  pickObsidianFolder(): Promise<{ readonly info: AppInfo; readonly written: number } | null>
  /** Stops writing Obsidian notes; files already written stay. */
  clearObsidianFolder(): Promise<AppInfo>
  /** Opens a new GitHub issue with the version and Windows build filled in. */
  reportProblem(): void
  getUpdateStatus(): Promise<UpdateStatus>
  /** Looks for a newer version on GitHub and starts downloading it. */
  checkForUpdate(): Promise<UpdateStatus>
  /** Restarts into the downloaded version. */
  installUpdate(): void
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void
  copyText(text: string): void
  setPinned(on: boolean): Promise<void>
  openMain(tab?: MainTab): void
  windowAction(action: WindowAction): void
  hideWindow(): void
  onChanged(listener: () => void): () => void
  onNavigate(listener: (tab: MainTab) => void): () => void
}

export const CHANNELS = {
  getNow: 'now:get',
  getMain: 'main:get',
  capture: 'item:capture',
  complete: 'item:complete',
  reopen: 'item:reopen',
  postpone: 'item:postpone',
  plan: 'item:plan',
  setDue: 'item:due',
  rename: 'item:rename',
  remove: 'item:remove',
  drop: 'item:drop',
  rescheduleOverdue: 'item:reschedule-overdue',
  undoBatch: 'item:undo-batch',
  undoRemove: 'item:undo-remove',
  addStep: 'item:add-step',
  createRoutine: 'routine:create',
  updateRoutine: 'routine:update',
  getRoutineHistory: 'routine:history',
  recordRoutine: 'routine:record',
  removeRoutineRecord: 'routine:remove-record',
  startFocus: 'focus:start',
  extendFocus: 'focus:extend',
  stopFocus: 'focus:stop',
  getMonth: 'calendar:month',
  getDay: 'calendar:day',
  captureOn: 'calendar:capture',
  addManualEntry: 'calendar:add-entry',
  removeManualEntry: 'calendar:remove-entry',
  setDayNote: 'calendar:note',
  acknowledgeAgents: 'agent:acknowledge',
  dismissRecap: 'recap:dismiss',
  getIntegrations: 'integrations:get',
  setHook: 'integrations:hook',
  clearAgentData: 'integrations:clear',
  setStatusline: 'integrations:statusline',
  getAppInfo: 'app:info',
  setOpenAtLogin: 'app:open-at-login',
  setGlass: 'app:glass',
  setCaptureShortcut: 'app:capture-shortcut',
  openFolder: 'app:open-folder',
  exportData: 'app:export',
  pickObsidianFolder: 'app:obsidian-pick',
  clearObsidianFolder: 'app:obsidian-clear',
  reportProblem: 'app:report-problem',
  getUpdateStatus: 'update:get',
  checkForUpdate: 'update:check',
  installUpdate: 'update:install',
  updateStatus: 'update:status',
  copyText: 'app:copy',
  setPinned: 'float:pin',
  openMain: 'main:open',
  windowAction: 'window:action',
  hideWindow: 'window:hide',
  changed: 'now:changed',
  navigate: 'main:navigate',
} as const
