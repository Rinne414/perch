import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseQuota, sameQuota, type QuotaSnapshot } from '../shared/quota'
import { parseJsonText } from './inbox'

/** Rewriting unchanged numbers this often still tells the app the agent is alive. */
const REFRESH_MS = 60_000

/** One file per agent, overwritten in place; the inbox's own event files stay separate. */
export const quotaFile = (inboxDir: string, agent: string): string => join(inboxDir, 'quota', `${agent}.json`)

export function readQuota(inboxDir: string, agent: string): QuotaSnapshot | null {
  try {
    return parseQuota(parseJsonText(readFileSync(quotaFile(inboxDir, agent), 'utf8')))
  } catch {
    return null
  }
}

/** Writes through a temporary file so the app never reads half of it. */
function writeQuota(inboxDir: string, snapshot: QuotaSnapshot): void {
  const file = quotaFile(inboxDir, snapshot.agent)
  mkdirSync(join(inboxDir, 'quota'), { recursive: true })
  writeFileSync(`${file}.tmp`, JSON.stringify(snapshot), 'utf8')
  renameSync(`${file}.tmp`, file)
}

/**
 * The status line runs after every reply; the file only changes when the numbers do,
 * or once a minute. Returns whether it wrote.
 */
export function saveQuota(inboxDir: string, snapshot: QuotaSnapshot): boolean {
  const stored = readQuota(inboxDir, snapshot.agent)
  if (stored && sameQuota(stored, snapshot) && snapshot.at - stored.at < REFRESH_MS) return false
  writeQuota(inboxDir, snapshot)
  return true
}
