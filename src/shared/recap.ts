import type { TimelineEvent } from './types'

export interface Recap {
  /** The day being summarised (YYYY-MM-DD). */
  readonly day: string
  readonly itemsDone: number
  readonly routinesDone: number
  readonly agentsDone: number
}

/** One-line summary of a day, or null when nothing happened worth mentioning. */
export function buildRecap(day: string, events: readonly TimelineEvent[]): Recap | null {
  let itemsDone = 0
  let routinesDone = 0
  const agents = new Set<string>()
  for (const e of events) {
    if (e.type === 'item.done' && !e.data?.['stepOf']) itemsDone++
    else if (e.type === 'routine.done') routinesDone++
    else if (e.type === 'agent.status' && e.data?.['status'] === 'done' && e.agentSessionId) {
      agents.add(e.agentSessionId)
    }
  }
  if (itemsDone + routinesDone + agents.size === 0) return null
  return { day, itemsDone, routinesDone, agentsDone: agents.size }
}
