import { describe, expect, test } from 'vitest'
import { allIdle, countdownReason, leftLabel, nextClockTime, parseNvidiaSmi, powerSummary } from './power'

const at = (d: number, h: number, m = 0, s = 0): number => new Date(2026, 9, d, h, m, s).getTime()
const NOW = at(5, 22, 18)

describe('nvidia-smi output', () => {
  test('reads one GPU per line', () => {
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 3090, 100\r\n')).toEqual([{ name: 'NVIDIA GeForce RTX 3090', utilization: 100 }])
    expect(parseNvidiaSmi('GPU A, 3\nGPU B, 87\n')).toEqual([
      { name: 'GPU A', utilization: 3 },
      { name: 'GPU B', utilization: 87 },
    ])
  })

  test('anything unexpected is no reading at all', () => {
    expect(parseNvidiaSmi('')).toBeNull()
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 3090, [N/A]')).toBeNull()
    expect(parseNvidiaSmi('NVIDIA-SMI has failed because it could not communicate with the NVIDIA driver.')).toBeNull()
    expect(parseNvidiaSmi('GPU A, 3\nGPU B, [Not Supported]')).toBeNull()
    expect(parseNvidiaSmi('GPU A, 140')).toBeNull()
  })
})

describe('idle', () => {
  test('needs every GPU at or below 10%', () => {
    expect(allIdle([{ name: 'a', utilization: 10 }])).toBe(true)
    expect(allIdle([{ name: 'a', utilization: 11 }])).toBe(false)
    expect(allIdle([{ name: 'a', utilization: 0 }, { name: 'b', utilization: 60 }])).toBe(false)
  })

  test('a missing reading is never idle', () => {
    expect(allIdle(null)).toBe(false)
    expect(allIdle([])).toBe(false)
  })
})

describe('typed time', () => {
  test('is the next time the clock shows it', () => {
    expect(nextClockTime('23:30', NOW)).toBe(at(5, 23, 30))
    expect(nextClockTime(' 23：30 ', NOW)).toBe(at(5, 23, 30))
    expect(nextClockTime('7:05', NOW)).toBe(at(6, 7, 5))
    expect(nextClockTime('22:18', NOW)).toBe(at(6, 22, 18))
  })

  test('refuses what is not a time', () => {
    for (const bad of ['', '23', '24:00', '12:60', '晚上11點', '1:5']) expect(nextClockTime(bad, NOW)).toBeNull()
  })
})

describe('labels', () => {
  test('time left rounds up to whole minutes', () => {
    expect(leftLabel(30_000)).toBe('1 分')
    expect(leftLabel(45 * 60_000)).toBe('45 分')
    expect(leftLabel(72 * 60_000)).toBe('1 小時 12 分')
    expect(leftLabel(120 * 60_000)).toBe('2 小時')
  })

  test('a timer shows its clock time, with 明天 when it is tomorrow', () => {
    expect(powerSummary({ kind: 'timer', at: at(5, 23, 30) }, NOW)).toEqual({
      title: '23:30 關機',
      detail: '還有 1 小時 12 分',
      progress: null,
    })
    expect(powerSummary({ kind: 'timer', at: at(6, 7, 0) }, NOW).title).toBe('明天 07:00 關機')
  })

  test('a GPU plan says how long it has been idle', () => {
    const gpus = [{ name: 'RTX 3090', utilization: 4 }]
    const idle = powerSummary({ kind: 'gpu', idleMinutes: 5, idleSince: NOW - 2 * 60_000, gpus }, NOW)
    expect(idle.detail).toBe('已經閒了 2 分，再 3 分開始倒數 · 現在 4%')
    expect(idle.progress).toBeCloseTo(0.4)
    const busy = powerSummary({ kind: 'gpu', idleMinutes: 5, idleSince: null, gpus: [{ name: 'x', utilization: 97 }] }, NOW)
    expect(busy.detail).toBe('GPU 還在跑（97%）· 要連續 5 分鐘低於 10%')
    const unknown = powerSummary({ kind: 'gpu', idleMinutes: 5, idleSince: null, gpus: null }, NOW)
    expect(unknown.detail).toContain('讀不到 GPU 狀態，先不關')
  })

  test('the countdown names its reason', () => {
    expect(countdownReason({ kind: 'gpu', idleMinutes: 5, idleSince: 0, gpus: null }, NOW)).toBe('GPU 已經連續 5 分鐘低於 10%')
    expect(countdownReason({ kind: 'timer', at: at(5, 23, 30) }, NOW)).toBe('排好 23:30 關機')
  })
})
