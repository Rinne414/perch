import { app, powerMonitor } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import type { AwayStretch } from '@shared/briefing'
import { getSetting, setSetting } from './db/settings'
import { asAwayState, parseAwayOverride, shownAway, stepAway, type AwayState } from './services/away'

const KEY = 'away'
/** The tick time alone is saved at most this often; a stretch starting or ending is saved at once. */
const SAVE_TICK_MS = 60_000

const sameStretch = (a: AwayStretch | null, b: AwayStretch | null): boolean => a?.from === b?.from && a?.to === b?.to

/** The stretch the briefing shows now; TC_AWAY replaces it in development runs. */
export function currentAway(db: DatabaseSync, now: number): AwayStretch | null {
  const override = app.isPackaged ? null : parseAwayOverride(process.env['TC_AWAY'])
  return override ?? shownAway(asAwayState(getSetting<unknown>(db, KEY, null)), now)
}

/**
 * Follows keyboard and mouse idle time, one call per scheduler tick. Returns true when the
 * stretch the briefing shows changed, so the windows refresh.
 */
export function createAwayWatch(db: DatabaseSync): (now: number) => boolean {
  let state: AwayState = asAwayState(getSetting<unknown>(db, KEY, null))
  let savedTickAt = state.lastTickAt ?? 0
  return (now) => {
    const before = state
    state = stepAway(state, now, powerMonitor.getSystemIdleTime())
    const moved = before.openFrom !== state.openFrom || !sameStretch(before.last, state.last)
    if (moved || now - savedTickAt >= SAVE_TICK_MS) {
      setSetting(db, KEY, state)
      savedTickAt = now
    }
    return !sameStretch(shownAway(before, now), shownAway(state, now))
  }
}
