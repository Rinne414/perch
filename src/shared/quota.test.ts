import { describe, expect, test } from 'vitest'
import { liveWindows, parseQuota, quotaAlert, quotaFromStatusline, resetLabel, sameQuota, statuslineText } from './quota'

const at = (d: number, h: number, m = 0): number => new Date(2026, 8, d, h, m).getTime()
const NOW = at(30, 11)
const input = {
  model: { display_name: 'Opus' },
  rate_limits: {
    five_hour: { used_percentage: 23.5, resets_at: at(30, 16) / 1000 },
    seven_day: { used_percentage: 41.2, resets_at: at(3 + 30, 9) / 1000 },
  },
}

describe('Claude Code quota', () => {
  test('is read from the status line input, reset times in milliseconds', () => {
    expect(quotaFromStatusline(input, NOW)).toEqual({
      v: 1,
      agent: 'claude-code',
      at: NOW,
      windows: [
        { key: 'five_hour', usedPercent: 23.5, resetsAt: at(30, 16) },
        { key: 'seven_day', usedPercent: 41.2, resetsAt: at(33, 9) },
      ],
    })
  })

  test('is missing for API users and before the first reply', () => {
    expect(quotaFromStatusline({ model: {} }, NOW)).toBeNull()
    expect(quotaFromStatusline({ rate_limits: { five_hour: { used_percentage: 'x' } } }, NOW)).toBeNull()
    expect(quotaFromStatusline('nonsense', NOW)).toBeNull()
  })

  test('shows as a short line under the prompt', () => {
    expect(statuslineText(quotaFromStatusline(input, NOW))).toBe('5h 24% · 7d 41%')
    expect(statuslineText(null)).toBe('')
  })

  test('only counts windows that have not reset yet', () => {
    const snap = quotaFromStatusline(input, NOW)
    expect(liveWindows(snap, at(30, 17)).map((w) => w.key)).toEqual(['seven_day'])
  })

  test('alerts the float only at 80% of the 5-hour window', () => {
    const snap = (used: number) => quotaFromStatusline({ rate_limits: { five_hour: { used_percentage: used, resets_at: at(30, 16) / 1000 } } }, NOW)
    expect(quotaAlert(snap(79), NOW)).toBeNull()
    expect(quotaAlert(snap(86), NOW)?.usedPercent).toBe(86)
    expect(quotaAlert(snap(86), at(30, 16, 1))).toBeNull()
  })

  test('says when a window resets', () => {
    expect(resetLabel(at(30, 16), NOW)).toBe('16:00 重置')
    expect(resetLabel(at(31, 9), NOW)).toBe('明天 09:00 重置')
    expect(resetLabel(at(33, 9), NOW)).toBe('10/3 週六 09:00 重置')
  })

  test('a stored snapshot is checked field by field', () => {
    const snap = quotaFromStatusline(input, NOW)!
    expect(parseQuota(JSON.parse(JSON.stringify(snap)))).toEqual(snap)
    expect(parseQuota({ ...snap, v: 2 })).toBeNull()
    expect(parseQuota({ ...snap, windows: [{ key: 'hourly', usedPercent: 1, resetsAt: 1 }] })?.windows).toEqual([])
  })

  test('the same numbers reported later count as unchanged', () => {
    const a = quotaFromStatusline(input, NOW)!
    expect(sameQuota(a, { ...a, at: NOW + 60_000 })).toBe(true)
    expect(sameQuota(a, quotaFromStatusline({ rate_limits: { five_hour: { used_percentage: 30, resets_at: at(30, 16) / 1000 } } }, NOW)!)).toBe(false)
  })
})
