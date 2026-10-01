import { dayKey } from '@shared/day'
import { liveWindows, quotaAlert } from '@shared/quota'
import { readQuota } from '../integrations/quota'
import type { AppContext } from './context'
import { listAgentSessions } from './db/agents'
import { listOpenItems, rolloverPlans, updateItem } from './db/items'
import { transaction } from './db/transaction'
import { notify } from './notify'
import { agentAlert, agentsToNotify, dueAlert, dueItemsToNotify } from './services/reminders'
import { scheduleAlerts } from './services/scheduleAlerts'
import { clearExpiredClips } from './services/clips'
import { clipsDir } from './paths'

const TICK_MS = 20_000
const HOUR_MS = 3_600_000
const AGENT_LOOKBACK_MS = 2 * 3_600_000

/**
 * Background loop: rolls unfinished plans onto the new day, sends due reminders,
 * and announces agents that are waiting on the person. Returns a stop function.
 */
export function startScheduler(ctx: AppContext, beforeTick: () => void = () => undefined): () => void {
  const announced = new Map<string, number>()
  let quotaSeen = ''
  let lastDay = ''
  let clipsCleared = 0

  const tick = (): void => {
    beforeTick()
    const { db } = ctx
    const settings = ctx.settings()
    const now = Date.now()
    let changed = rolloverPlans(db, dayKey(now, settings.dayStartHour), now) > 0

    const due = dueItemsToNotify(listOpenItems(db), now, settings)
    const alert = dueAlert(due)
    if (alert) {
      transaction(db, () => due.forEach((i) => updateItem(db, i.id, { notifiedAt: now }, now)))
      notify(alert, () => ctx.showFloat('todo'))
      changed = true
    }

    for (const alert of scheduleAlerts(db, now)) notify(alert, () => ctx.showFloat('todo'))

    // New numbers from Claude Code's status line, a window that reset, or the 5-hour alert coming or going.
    const quota = readQuota(ctx.hookSetup.inboxDir, 'claude-code')
    const quotaNow = `${quota?.at ?? 0}/${liveWindows(quota, now).length}/${quotaAlert(quota, now) ? 1 : 0}`
    if (quotaNow !== quotaSeen) {
      quotaSeen = quotaNow
      changed = true
    }

    // Today's Obsidian note follows the day; the day that just ended gets its last write.
    const today = dayKey(now, settings.dayStartHour)
    if (lastDay && lastDay !== today) ctx.syncObsidian(lastDay)
    ctx.syncObsidian(today)
    lastDay = today

    for (const s of agentsToNotify(listAgentSessions(db, now - AGENT_LOOKBACK_MS), announced, now)) {
      announced.set(s.id, s.attentionAt!)
      notify(agentAlert(s), () => ctx.showFloat('agents'))
    }

    // 暫存 left unused for the chosen days goes, once an hour.
    if (now - clipsCleared >= HOUR_MS) {
      clipsCleared = now
      try {
        if (clearExpiredClips(db, clipsDir(), now, settings.clipRetentionDays) > 0) changed = true
      } catch (err) {
        ctx.log.error('Clearing old clips failed', err)
      }
    }

    if (changed) ctx.broadcast()
  }

  tick()
  const timer = setInterval(tick, TICK_MS)
  return () => clearInterval(timer)
}
