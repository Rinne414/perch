import {
  allIdle,
  IDLE_MINUTE_CHOICES,
  MAX_TIMER_MINUTES,
  nextClockTime,
  type GpuReading,
  type PowerPlan,
  type PowerState,
} from '@shared/power'

const MAX_CLOCK_TEXT = 16

/** A plan that cannot be made as asked; the message is written for the person. */
export class PlanError extends Error {}

/** `{ minutes: 30 }` or `{ clock: "23:30" }` from the float or the phone, as a time to shut down at. */
export function timerAt(when: unknown, now: number, minuteMs: number): number {
  const w = (typeof when === 'object' && when !== null ? when : {}) as { minutes?: unknown; clock?: unknown }
  if (typeof w.minutes === 'number' && Number.isInteger(w.minutes) && w.minutes >= 1 && w.minutes <= MAX_TIMER_MINUTES) {
    return now + w.minutes * minuteMs
  }
  if (typeof w.clock === 'string' && w.clock.length <= MAX_CLOCK_TEXT) {
    const at = nextClockTime(w.clock, now)
    if (at !== null) return at
  }
  throw new PlanError('看不懂這個時間，請打像 23:30 這樣')
}

/** A poll that comes this late means the computer slept (or hung); a missed plan is dropped, never run late. */
export const SLEEP_GAP_MS = 30_000
/**
 * Polls come every second during the countdown, so a longer gap there means sleep or a clock
 * that jumped: either way the minute of warning did not really happen, and the countdown stops.
 */
export const COUNTDOWN_GAP_MS = 5_000
/** The GPU is read this many times as often during the countdown, and once more right before shutting down. */
const COUNTDOWN_READ_FACTOR = 3
/** The panel's live reading is reused for this long. */
const READING_FRESH_MS = 3_000

export interface PowerDeps {
  readonly supported: boolean
  readonly minuteMs: number
  /** How often the GPU is read while a GPU plan is armed. */
  readonly gpuPollMs: number
  /** null when the reading failed: no driver, no nvidia-smi, odd output. */
  readGpus(): Promise<GpuReading[] | null>
  /** Asks the system for a normal shutdown; rejects when the system refuses. */
  shutdown(): Promise<void>
  /** Puts the shutdown on the timeline; the returned function takes it back if the shutdown fails. */
  record(plan: PowerPlan): () => void
  changed(state: PowerState): void
  /** The last minute began: show the countdown and a notification. */
  countdownStarted(state: PowerState, plan: PowerPlan): void
  /** Something the person should hear about: a refused shutdown, a plan dropped after sleep. */
  warn(title: string, body: string): void
}

export interface Power {
  state(): PowerState
  /** Shuts down at `at` (after the last-minute countdown); `note` replaces the countdown's reason. */
  armTimer(at: number, now: number, note?: string): PowerState
  /** Shuts down once every GPU has stayed idle for `idleMinutes`. */
  armGpu(idleMinutes: number, now: number): PowerState
  cancel(): PowerState
  /** "現在關" in the countdown window; ignored when no countdown runs. */
  shutdownNow(): Promise<void>
  /** Called about once a second while a plan is armed. */
  poll(now: number): Promise<void>
  /** A reading for the panel, reused while a few seconds old. */
  readGpus(now: number): Promise<GpuReading[] | null>
}

/**
 * One planned shutdown at a time, kept in memory only: if Perch quits or restarts, the plan is
 * gone and nothing shuts down later by surprise. Anything unclear (a failed GPU reading, a
 * computer that slept past its time) leads to NOT shutting down.
 */
export function createPower(deps: PowerDeps): Power {
  let plan: PowerPlan | null = null
  let countdownEndsAt: number | null = null
  let lastPoll = 0
  let lastGpuRead = 0
  let reading: { at: number; gpus: GpuReading[] | null } | null = null
  let inFlight: Promise<GpuReading[] | null> | null = null
  let polling = false

  const state = (): PowerState => ({ supported: deps.supported, plan, countdownEndsAt, minuteMs: deps.minuteMs })
  const changed = (): PowerState => {
    const s = state()
    deps.changed(s)
    return s
  }

  /** `fresh` skips the cached reading: the last check before shutting down must be current. */
  const read = (now: number, fresh = false): Promise<GpuReading[] | null> => {
    if (!fresh && reading && now - reading.at < READING_FRESH_MS) return Promise.resolve(reading.gpus)
    inFlight ??= deps
      .readGpus()
      .catch(() => null)
      .then((gpus) => {
        reading = { at: now, gpus }
        inFlight = null
        return gpus
      })
    return inFlight
  }

  const arm = (next: PowerPlan, now: number): PowerState => {
    if (!deps.supported) throw new PlanError('這台電腦不支援自動關機')
    plan = next
    countdownEndsAt = null
    lastPoll = now
    lastGpuRead = 0
    return changed()
  }

  const drop = (title: string, body: string): void => {
    plan = null
    countdownEndsAt = null
    changed()
    deps.warn(title, body)
  }

  const fire = async (): Promise<void> => {
    const ran = plan
    if (!ran) return
    plan = null
    countdownEndsAt = null
    changed()
    let undo = (): void => undefined
    try {
      undo = deps.record(ran)
      await deps.shutdown()
    } catch (err) {
      undo()
      deps.warn('關機沒有成功', err instanceof Error ? err.message : String(err))
    }
  }

  const startCountdown = (endsAt: number, current: PowerPlan): void => {
    countdownEndsAt = endsAt
    deps.countdownStarted(changed(), current)
  }

  const pollGpu = async (current: Extract<PowerPlan, { kind: 'gpu' }>, now: number, fresh: boolean): Promise<void> => {
    lastGpuRead = now
    const gpus = await read(now, fresh)
    if (plan !== current) return // cancelled or replaced while nvidia-smi ran
    const idle = allIdle(gpus)
    const next = { ...current, gpus, idleSince: idle ? (current.idleSince ?? now) : null }
    plan = next
    if (!idle && countdownEndsAt !== null) countdownEndsAt = null // work came back during the last minute
    if (idle && countdownEndsAt === null && now - next.idleSince! >= next.idleMinutes * deps.minuteMs) {
      startCountdown(now + deps.minuteMs, next)
      return
    }
    changed()
  }

  const step = async (now: number): Promise<void> => {
    const current = plan
    if (!current) return
    const gap = lastPoll > 0 ? now - lastPoll : 0
    const slept = gap > SLEEP_GAP_MS
    lastPoll = now

    if (countdownEndsAt !== null && (slept || gap > COUNTDOWN_GAP_MS)) {
      drop('關機取消了', '倒數被打斷了（電腦睡著或時間跳動），所以這次不關。')
      return
    }
    if (current.kind === 'timer') {
      if (slept && now > current.at) {
        drop('錯過的關機取消了', '電腦睡著時錯過了排好的關機時間，所以這次不關。')
        return
      }
      if (countdownEndsAt === null && now >= current.at - deps.minuteMs) {
        startCountdown(Math.max(current.at, now + deps.minuteMs), current)
        return
      }
    } else {
      // After a sleep the idle stretch starts over: minutes asleep are not minutes of a free GPU.
      const fresh = slept ? { ...current, idleSince: null } : current
      plan = fresh
      // During the last minute the GPU is watched more closely, and read once more right at the end.
      const due = countdownEndsAt !== null && now >= countdownEndsAt
      const every = countdownEndsAt !== null ? Math.round(deps.gpuPollMs / COUNTDOWN_READ_FACTOR) : deps.gpuPollMs
      if (slept || due || now - lastGpuRead >= every) await pollGpu(fresh, now, due)
    }
    if (plan !== null && countdownEndsAt !== null && now >= countdownEndsAt) await fire()
  }

  return {
    state,
    armTimer(at, now, note) {
      if (!Number.isFinite(at) || at <= now) throw new PlanError('關機時間要在現在之後')
      if (at - now > MAX_TIMER_MINUTES * deps.minuteMs) throw new PlanError('最多排 24 小時後')
      return arm(note ? { kind: 'timer', at, note } : { kind: 'timer', at }, now)
    },
    armGpu(idleMinutes, now) {
      if (!IDLE_MINUTE_CHOICES.includes(idleMinutes)) throw new PlanError('閒置分鐘數只能選 3、5、10、15')
      const gpus = reading?.gpus ?? null
      return arm({ kind: 'gpu', idleMinutes, idleSince: null, gpus }, now)
    },
    cancel() {
      plan = null
      countdownEndsAt = null
      return changed()
    },
    async shutdownNow() {
      if (plan && countdownEndsAt !== null) await fire()
    },
    async poll(now) {
      if (polling) return // a slow nvidia-smi must not stack up polls
      polling = true
      try {
        await step(now)
      } finally {
        polling = false
      }
    },
    readGpus: read,
  }
}
