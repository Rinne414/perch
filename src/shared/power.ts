import { clock } from './format'

/** A GPU counts as free at or below this utilization, in percent. */
export const IDLE_UTILIZATION = 10
export const IDLE_MINUTE_CHOICES: readonly number[] = [3, 5, 10, 15]
export const DEFAULT_IDLE_MINUTES = 5
export const TIMER_PRESETS: readonly number[] = [30, 60, 120, 180]
export const MAX_TIMER_MINUTES = 24 * 60
export const MINUTE_MS = 60_000

export interface GpuReading {
  readonly name: string
  /** Percent, 0-100. */
  readonly utilization: number
}

export type PowerPlan =
  | {
      readonly kind: 'timer'
      readonly at: number
      /** Says who asked, when it was not the float ("從手機按了「現在關機」"). */
      readonly note?: string
    }
  | {
      readonly kind: 'gpu'
      readonly idleMinutes: number
      /** When every GPU went quiet; null while any is busy or could not be read. */
      readonly idleSince: number | null
      /** The latest reading; null when nvidia-smi failed or has not answered yet. */
      readonly gpus: readonly GpuReading[] | null
    }

export interface PowerState {
  /** Shutting down is offered on Windows only. */
  readonly supported: boolean
  readonly plan: PowerPlan | null
  /** Set during the last minute: when the computer shuts down unless someone cancels. */
  readonly countdownEndsAt: number | null
  /** One "minute" in milliseconds; shorter only in development tests. */
  readonly minuteMs: number
}

/**
 * nvidia-smi's `--query-gpu=name,utilization.gpu --format=csv,noheader,nounits`: one
 * "NVIDIA GeForce RTX 3090, 100" line per GPU. Anything else, "[N/A]" included, is null,
 * and null never counts as idle.
 */
export function parseNvidiaSmi(out: string): GpuReading[] | null {
  const gpus: GpuReading[] = []
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue
    const cut = line.lastIndexOf(',')
    const name = line.slice(0, cut).trim()
    const value = line.slice(cut + 1).trim()
    const utilization = Number(value)
    if (cut < 0 || !name || !/^\d+(\.\d+)?$/.test(value) || utilization > 100) return null
    gpus.push({ name, utilization })
  }
  return gpus.length > 0 ? gpus : null
}

/** Every GPU at or below the idle line. No reading is never idle. */
export const allIdle = (gpus: readonly GpuReading[] | null): boolean =>
  gpus !== null && gpus.length > 0 && gpus.every((g) => g.utilization <= IDLE_UTILIZATION)

/** The busiest GPU's utilization, or null without a reading. */
export const busiest = (gpus: readonly GpuReading[] | null): number | null =>
  gpus && gpus.length > 0 ? Math.max(...gpus.map((g) => g.utilization)) : null

/** The next time the clock shows "23:30" (also "7:05", "23：30"); null when it is not a time. */
export function nextClockTime(text: string, now: number): number | null {
  const m = /^\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*$/.exec(text)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return null
  const d = new Date(now)
  d.setHours(hour, minute, 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  return d.getTime()
}

/** "45 分", "1 小時 12 分", "2 小時" — time left, rounded up to whole minutes. */
export function leftLabel(ms: number, minuteMs = MINUTE_MS): string {
  const minutes = Math.max(1, Math.ceil(ms / minuteMs))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} 分`
  return m ? `${h} 小時 ${m} 分` : `${h} 小時`
}

const sameDay = (a: number, b: number): boolean => new Date(a).toDateString() === new Date(b).toDateString()

/** "23:30", or "明天 07:00" when it falls on the next day. */
export const timerClock = (at: number, now: number): string => (sameDay(at, now) ? clock(at) : `明天 ${clock(at)}`)

export interface PowerSummary {
  readonly title: string
  readonly detail: string
  /** 0-1 of the idle stretch the GPU still needs; null for a timer. */
  readonly progress: number | null
}

/** The line under the float's header while a shutdown is planned. */
export function powerSummary(plan: PowerPlan, now: number, minuteMs = MINUTE_MS): PowerSummary {
  if (plan.kind === 'timer') {
    return { title: `${timerClock(plan.at, now)} 關機`, detail: `還有 ${leftLabel(plan.at - now, minuteMs)}`, progress: null }
  }
  const title = 'GPU 閒下來就關機'
  const need = `要連續 ${plan.idleMinutes} 分鐘低於 ${IDLE_UTILIZATION}%`
  const top = busiest(plan.gpus)
  if (top === null) return { title, detail: `讀不到 GPU 狀態，先不關 · ${need}`, progress: 0 }
  if (plan.idleSince === null) return { title, detail: `GPU 還在跑（${top}%）· ${need}`, progress: 0 }
  const idleMs = Math.max(0, now - plan.idleSince)
  const needMs = plan.idleMinutes * minuteMs
  return {
    title,
    detail: `已經閒了 ${Math.floor(idleMs / minuteMs)} 分，再 ${leftLabel(needMs - idleMs, minuteMs)}開始倒數 · 現在 ${top}%`,
    progress: Math.min(1, idleMs / needMs),
  }
}

/** Why the countdown started, for its window and the timeline. */
export function countdownReason(plan: PowerPlan, now: number): string {
  if (plan.kind === 'gpu') return `GPU 已經連續 ${plan.idleMinutes} 分鐘低於 ${IDLE_UTILIZATION}%`
  return plan.note ?? `排好 ${timerClock(plan.at, now)} 關機`
}
