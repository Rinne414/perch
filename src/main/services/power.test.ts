import { describe, expect, test } from 'vitest'
import type { GpuReading, PowerPlan, PowerState } from '@shared/power'
import { createPower, SLEEP_GAP_MS, type PowerDeps } from './power'

const MIN = 60_000
const T0 = new Date(2026, 9, 5, 22, 0).getTime()

/** Fake system: records what Power asked for instead of doing it. */
class Harness {
  /** What nvidia-smi answers next; null = it failed. */
  gpus: GpuReading[] | null = [{ name: 'RTX 3090', utilization: 100 }]
  refuse = false
  shutdowns = 0
  readonly records: PowerPlan[] = []
  readonly undone: PowerPlan[] = []
  readonly countdowns: PowerState[] = []
  readonly warnings: string[] = []
  readonly deps: PowerDeps

  constructor(supported: boolean) {
    this.deps = {
      supported,
      minuteMs: MIN,
      gpuPollMs: 15_000,
      readGpus: async () => this.gpus,
      shutdown: async () => {
        if (this.refuse) throw new Error('Access is denied.')
        this.shutdowns++
      },
      record: (plan) => {
        this.records.push(plan)
        return () => this.undone.push(plan)
      },
      changed: () => undefined,
      countdownStarted: (s) => this.countdowns.push(s),
      warn: (title) => this.warnings.push(title),
    }
  }
}

const harness = (supported = true): Harness => new Harness(supported)

/** Polls once a second from `from` to `to`, like the app does. */
async function run(power: ReturnType<typeof createPower>, from: number, to: number): Promise<void> {
  for (let t = from; t <= to; t += 1000) await power.poll(t)
}

describe('shutdown timer', () => {
  test('counts down for the last minute, then shuts down once', async () => {
    const h = harness()
    const power = createPower(h.deps)
    power.armTimer(T0 + 30 * MIN, T0)
    await run(power, T0, T0 + 29 * MIN - 1000)
    expect(h.countdowns).toHaveLength(0)
    await power.poll(T0 + 29 * MIN)
    expect(power.state().countdownEndsAt).toBe(T0 + 30 * MIN)
    await run(power, T0 + 29 * MIN + 1000, T0 + 30 * MIN - 1000)
    expect(h.shutdowns).toBe(0)
    await run(power, T0 + 30 * MIN, T0 + 31 * MIN)
    expect(h.shutdowns).toBe(1)
    expect(h.records).toEqual([{ kind: 'timer', at: T0 + 30 * MIN }])
    expect(power.state().plan).toBeNull()
  })

  test('a time less than a minute away still gets the full minute of warning', async () => {
    const h = harness()
    const power = createPower(h.deps)
    power.armTimer(T0 + 20_000, T0)
    await power.poll(T0 + 1000)
    expect(power.state().countdownEndsAt).toBe(T0 + 1000 + MIN)
  })

  test('cancelling stops it', async () => {
    const h = harness()
    const power = createPower(h.deps)
    power.armTimer(T0 + 2 * MIN, T0)
    await run(power, T0, T0 + MIN + 5000)
    expect(power.state().countdownEndsAt).not.toBeNull()
    power.cancel()
    await run(power, T0 + MIN + 6000, T0 + 3 * MIN)
    expect(h.shutdowns).toBe(0)
    expect(power.state()).toMatchObject({ plan: null, countdownEndsAt: null })
  })

  test('a time missed while the computer slept is dropped, not run on waking', async () => {
    const h = harness()
    const power = createPower(h.deps)
    power.armTimer(T0 + 30 * MIN, T0)
    await run(power, T0, T0 + 10 * MIN)
    await power.poll(T0 + 9 * 60 * MIN) // woke up the next morning
    expect(h.shutdowns).toBe(0)
    expect(h.countdowns).toHaveLength(0)
    expect(power.state().plan).toBeNull()
    expect(h.warnings).toEqual(['錯過的關機取消了'])
  })

  test('sleeping during the countdown cancels it', async () => {
    const h = harness()
    const power = createPower(h.deps)
    power.armTimer(T0 + 2 * MIN, T0)
    await run(power, T0, T0 + MIN + 10_000)
    await power.poll(T0 + MIN + 10_000 + SLEEP_GAP_MS + 1)
    expect(h.shutdowns).toBe(0)
    expect(h.warnings).toEqual(['關機取消了'])
  })

  test('a clock that jumps ahead during the countdown stops it', async () => {
    const h = harness()
    const power = createPower(h.deps)
    power.armTimer(T0 + 2 * MIN, T0)
    await run(power, T0, T0 + MIN + 10_000)
    expect(power.state().countdownEndsAt).not.toBeNull()
    await power.poll(T0 + MIN + 10_000 + 20_000) // 20 s gone in one step
    await run(power, T0 + MIN + 31_000, T0 + 3 * MIN)
    expect(h.shutdowns).toBe(0)
    expect(h.warnings).toEqual(['關機取消了'])
  })

  test('refuses a time in the past or more than a day away', () => {
    const power = createPower(harness().deps)
    expect(() => power.armTimer(T0 - 1, T0)).toThrow()
    expect(() => power.armTimer(T0 + 24 * 60 * MIN + 1, T0)).toThrow()
  })

  test('is not offered where shutting down is not supported', () => {
    const power = createPower(harness(false).deps)
    expect(() => power.armTimer(T0 + MIN * 5, T0)).toThrow()
    expect(() => power.armGpu(5, T0)).toThrow()
  })
})

describe('shut down when the GPU is free', () => {
  test('waits for the whole idle stretch, then counts down a minute', async () => {
    const h = harness()
    const power = createPower(h.deps)
    power.armGpu(5, T0)
    await run(power, T0, T0 + 10 * MIN) // rendering
    expect(h.countdowns).toHaveLength(0)
    h.gpus = [{ name: 'RTX 3090', utilization: 2 }]
    const freeAt = T0 + 10 * MIN + 1000
    await run(power, freeAt, freeAt + 5 * MIN - 16_000)
    expect(h.countdowns).toHaveLength(0)
    await run(power, freeAt + 5 * MIN - 15_000, freeAt + 5 * MIN + 15_000)
    expect(h.countdowns).toHaveLength(1)
    expect(h.shutdowns).toBe(0)
    await run(power, freeAt + 5 * MIN + 16_000, freeAt + 7 * MIN)
    expect(h.shutdowns).toBe(1)
    expect(h.records[0]).toMatchObject({ kind: 'gpu', idleMinutes: 5 })
  })

  test('a short pause between jobs starts the stretch over', async () => {
    const h = harness()
    const power = createPower(h.deps)
    power.armGpu(5, T0)
    h.gpus = [{ name: 'RTX 3090', utilization: 0 }]
    await run(power, T0, T0 + 4 * MIN)
    h.gpus = [{ name: 'RTX 3090', utilization: 95 }]
    await run(power, T0 + 4 * MIN + 1000, T0 + 5 * MIN)
    h.gpus = [{ name: 'RTX 3090', utilization: 0 }]
    await run(power, T0 + 5 * MIN + 1000, T0 + 9 * MIN)
    expect(h.countdowns).toHaveLength(0)
    expect(power.state().plan).toMatchObject({ kind: 'gpu' })
  })

  test('a failed reading never counts as idle', async () => {
    const h = harness()
    const power = createPower(h.deps)
    power.armGpu(3, T0)
    h.gpus = null
    await run(power, T0, T0 + 30 * MIN)
    expect(h.countdowns).toHaveLength(0)
    expect(h.shutdowns).toBe(0)
    expect(power.state().plan).toMatchObject({ kind: 'gpu', idleSince: null, gpus: null })
  })

  test('nvidia-smi throwing is the same as a failed reading', async () => {
    const h = harness()
    const power = createPower({ ...h.deps, readGpus: () => Promise.reject(new Error('ENOENT')) })
    power.armGpu(3, T0)
    await run(power, T0, T0 + 10 * MIN)
    expect(h.countdowns).toHaveLength(0)
  })

  test('work coming back during the countdown stops it and keeps waiting', async () => {
    const h = harness()
    const power = createPower(h.deps)
    power.armGpu(3, T0)
    h.gpus = [{ name: 'RTX 3090', utilization: 1 }]
    await run(power, T0, T0 + 3 * MIN + 15_000)
    expect(power.state().countdownEndsAt).not.toBeNull()
    h.gpus = [{ name: 'RTX 3090', utilization: 99 }]
    await run(power, T0 + 3 * MIN + 16_000, T0 + 6 * MIN)
    expect(h.shutdowns).toBe(0)
    expect(power.state()).toMatchObject({ countdownEndsAt: null, plan: { kind: 'gpu', idleSince: null } })
  })

  test('a job starting in the last seconds of the countdown is caught by the final reading', async () => {
    const h = harness()
    const power = createPower(h.deps)
    power.armGpu(3, T0)
    h.gpus = [{ name: 'RTX 3090', utilization: 1 }]
    await run(power, T0, T0 + 3 * MIN)
    const endsAt = power.state().countdownEndsAt!
    expect(endsAt).toBe(T0 + 4 * MIN)
    await run(power, T0 + 3 * MIN + 1000, endsAt - 1000)
    // The panel caches an idle reading half a second before the end; then a job starts.
    await power.readGpus(endsAt - 500)
    h.gpus = [{ name: 'RTX 3090', utilization: 98 }]
    await run(power, endsAt, endsAt + 5000)
    expect(h.shutdowns).toBe(0)
    expect(power.state()).toMatchObject({ countdownEndsAt: null, plan: { kind: 'gpu', idleSince: null } })
  })

  test('every GPU must be free', async () => {
    const h = harness()
    const power = createPower(h.deps)
    power.armGpu(3, T0)
    h.gpus = [
      { name: 'A', utilization: 0 },
      { name: 'B', utilization: 70 },
    ]
    await run(power, T0, T0 + 20 * MIN)
    expect(h.countdowns).toHaveLength(0)
  })

  test('minutes asleep do not count as idle minutes', async () => {
    const h = harness()
    const power = createPower(h.deps)
    power.armGpu(5, T0)
    h.gpus = [{ name: 'RTX 3090', utilization: 0 }]
    await run(power, T0, T0 + 2 * MIN)
    await power.poll(T0 + 60 * MIN)
    expect(h.countdowns).toHaveLength(0)
    expect(power.state().plan).toMatchObject({ idleSince: T0 + 60 * MIN })
  })

  test('only the offered idle lengths are accepted', () => {
    const power = createPower(harness().deps)
    expect(() => power.armGpu(1, T0)).toThrow()
    expect(power.armGpu(15, T0).plan).toMatchObject({ kind: 'gpu', idleMinutes: 15 })
  })
})

describe('shutting down', () => {
  test('現在關 works only during the countdown', async () => {
    const h = harness()
    const power = createPower(h.deps)
    power.armTimer(T0 + 10 * MIN, T0)
    await power.shutdownNow()
    expect(h.shutdowns).toBe(0)
    await run(power, T0, T0 + 9 * MIN)
    await power.shutdownNow()
    expect(h.shutdowns).toBe(1)
  })

  test('a refused shutdown takes its timeline entry back and says so', async () => {
    const h = harness()
    h.refuse = true
    const power = createPower(h.deps)
    power.armTimer(T0 + 2 * MIN, T0)
    await run(power, T0, T0 + 3 * MIN)
    expect(h.records).toHaveLength(1)
    expect(h.undone).toHaveLength(1)
    expect(h.warnings).toEqual(['關機沒有成功'])
    expect(power.state().plan).toBeNull()
  })

  test('a failure while recording is reported instead of thrown', async () => {
    const h = harness()
    const power = createPower({
      ...h.deps,
      record: () => {
        throw new Error('database is locked')
      },
    })
    power.armTimer(T0 + 2 * MIN, T0)
    await expect(run(power, T0, T0 + 3 * MIN)).resolves.toBeUndefined()
    expect(h.warnings).toEqual(['關機沒有成功'])
    expect(power.state().plan).toBeNull()
  })

  test('the panel reading is reused for a few seconds', async () => {
    const h = harness()
    let reads = 0
    const power = createPower({ ...h.deps, readGpus: async () => (reads++, h.gpus) })
    await power.readGpus(T0)
    await power.readGpus(T0 + 2000)
    expect(reads).toBe(1)
    await power.readGpus(T0 + 4000)
    expect(reads).toBe(2)
  })
})
