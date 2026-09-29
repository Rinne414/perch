import type { DatabaseSync } from 'node:sqlite'
import type { SourceUsage } from '@shared/integrations'
import { deleteAgentSessionsByAgent } from './agents'
import { deleteEventsBySource } from './events'
import { deleteItemsBySource } from './items'
import { transaction } from './transaction'

const PREFIX = 'agent:'

/** How much each agent has written, for every agent that left anything behind. */
export function agentSourceUsage(db: DatabaseSync): SourceUsage[] {
  const count = (sql: string): Map<string, number> =>
    new Map((db.prepare(sql).all() as { agent: string; n: number }[]).map((r) => [r.agent, r.n]))
  const sessions = count('SELECT agent, COUNT(*) AS n FROM agent_sessions GROUP BY agent')
  const events = count(
    `SELECT substr(source, ${PREFIX.length + 1}) AS agent, COUNT(*) AS n FROM events
     WHERE source LIKE '${PREFIX}%' GROUP BY source`,
  )
  const items = count(
    `SELECT substr(source, ${PREFIX.length + 1}) AS agent, COUNT(*) AS n FROM items
     WHERE source LIKE '${PREFIX}%' GROUP BY source`,
  )
  const agents = [...new Set([...sessions.keys(), ...events.keys(), ...items.keys()])].sort()
  return agents.map((agent) => ({
    agent,
    sessions: sessions.get(agent) ?? 0,
    events: events.get(agent) ?? 0,
    items: items.get(agent) ?? 0,
  }))
}

/** Removes everything one agent wrote: its sessions, its timeline entries and the items it created. */
export function clearAgentData(db: DatabaseSync, agent: string): number {
  const source = PREFIX + agent
  return transaction(
    db,
    () =>
      deleteAgentSessionsByAgent(db, agent) + deleteEventsBySource(db, source) + deleteItemsBySource(db, source),
  )
}
