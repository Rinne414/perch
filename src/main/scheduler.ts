import { dayKey } from '@shared/day'
import type { AppContext } from './context'
import { listAgentSessions } from './db/agents'
import { listOpenItems, rolloverPlans, updateItem } from './db/items'
import { transaction } from './db/transaction'
import { notify } from './notify'
import { agentAlert, agentsToNotify, dueAlert, dueItemsToNotify } from './services/reminders'

const TICK_MS = 20_000
const AGENT_LOOKBACK_MS = 2 * 3_600_000

/**
 * Background loop: rolls unfinished plans onto the new day, sends due reminders,
 * and announces agents that are waiting on the person. Returns a stop function.
 */
export function startScheduler(ctx: AppContext, beforeTick: () => void = () => undefined): () => void {
  const announced = new Map<string, number>()

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
      notify(alert, ctx.showFloat)
      changed = true
    }

    for (const s of agentsToNotify(listAgentSessions(db, now - AGENT_LOOKBACK_MS), announced, now)) {
      announced.set(s.id, s.attentionAt!)
      notify(agentAlert(s), ctx.showFloat)
    }

    if (changed) ctx.broadcast()
  }

  tick()
  const timer = setInterval(tick, TICK_MS)
  return () => clearInterval(timer)
}
