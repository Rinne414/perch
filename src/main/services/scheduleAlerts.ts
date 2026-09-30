import type { DatabaseSync } from 'node:sqlite'
import { clock } from '@shared/format'
import { dueReminders, untilLabel } from '@shared/schedule'
import { listOpenItems } from '../db/items'
import { getSetting, setSetting } from '../db/settings'
import type { Alert } from './reminders'

const KEY = 'scheduleReminded'
/** Keys older than this are dropped; a slot is never reminded after it started anyway. */
const KEEP_MS = 2 * 86_400_000

/**
 * Reminders for fixed-time routines ("上班 16:00 開始"). Each slot is announced
 * once; what was announced is stored so a restart inside the window stays quiet.
 */
export function scheduleAlerts(db: DatabaseSync, now: number): Alert[] {
  const sent = getSetting<string[]>(db, KEY, [])
  const fresh = dueReminders(listOpenItems(db), now).filter((o) => !sent.includes(`${o.item.id}@${o.startAt}`))
  if (fresh.length === 0) return []
  const kept = sent.filter((key) => Number(key.split('@')[1]) > now - KEEP_MS)
  setSetting(db, KEY, [...kept, ...fresh.map((o) => `${o.item.id}@${o.startAt}`)])
  return fresh.map((o) => ({
    title: `${o.item.title} ${clock(o.startAt)} 開始`,
    body: `${untilLabel(o.startAt - now)} · 到 ${clock(o.endAt)}`,
  }))
}
