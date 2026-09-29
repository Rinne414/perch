import type { IntegrationsPayload } from './integrations'
import type { MainView } from './mainView'
import type { NowView } from './now'
import type { Recap } from './recap'
import type { AgentSession, Item } from './types'

/** Where a captured line goes when it carries no date. */
export type CaptureTarget = 'today' | 'inbox'

export type MainTab = 'today' | 'inbox' | 'routines' | 'timeline' | 'calendar' | 'settings'
export const MAIN_TABS: readonly MainTab[] = ['today', 'inbox', 'routines', 'timeline', 'calendar', 'settings']

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
}

export interface MainPayload {
  readonly view: MainView
  readonly attention: readonly AgentSession[]
  /** Sessions still working, most recently active first. */
  readonly running: readonly AgentSession[]
  readonly dayStartHour: number
  /** Days untouched before an undated item moves to "舊的". */
  readonly staleDays: number
  readonly focus: FocusState | null
}

export interface AppInfo {
  readonly version: string
  readonly dataDir: string
  readonly openAtLogin: boolean
  /** Only an installed copy can start with Windows; a development run cannot. */
  readonly canOpenAtLogin: boolean
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
  createRoutine(title: string, intervalDays: number | null): Promise<void>
  updateRoutine(id: string, title: string, intervalDays: number | null): Promise<void>
  getRoutineHistory(id: string): Promise<RoutineHistory>
  /** Records a completion from typed text ("昨天", "前天晚上"). */
  recordRoutine(id: string, when: string): Promise<void>
  removeRoutineRecord(recordId: number): Promise<void>
  startFocus(itemId: string, stepId: string | null): Promise<void>
  extendFocus(): Promise<void>
  /** Returns the whole minutes that were logged (0 when under a minute). */
  stopFocus(): Promise<number>
  acknowledgeAgents(ids: readonly string[]): Promise<void>
  dismissRecap(): Promise<void>
  getIntegrations(): Promise<IntegrationsPayload>
  /** Installs (on = true) or removes an agent's hook; returns the fresh state. */
  setHook(agent: string, on: boolean): Promise<IntegrationsPayload>
  /** Deletes everything one agent wrote; returns how many rows went. */
  clearAgentData(agent: string): Promise<number>
  getAppInfo(): Promise<AppInfo>
  setOpenAtLogin(on: boolean): Promise<AppInfo>
  openDataFolder(): void
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
  acknowledgeAgents: 'agent:acknowledge',
  dismissRecap: 'recap:dismiss',
  getIntegrations: 'integrations:get',
  setHook: 'integrations:hook',
  clearAgentData: 'integrations:clear',
  getAppInfo: 'app:info',
  setOpenAtLogin: 'app:open-at-login',
  openDataFolder: 'app:open-data',
  copyText: 'app:copy',
  setPinned: 'float:pin',
  openMain: 'main:open',
  windowAction: 'window:action',
  hideWindow: 'window:hide',
  changed: 'now:changed',
  navigate: 'main:navigate',
} as const
