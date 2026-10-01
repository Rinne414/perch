import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent, ItemMessage } from '../shared/agentEvent'

/**
 * The inbox is a folder of small JSON files, one per event. Writers create a
 * temporary file and rename it, so a reader never sees half a file. There is
 * no network port: only programs already running as this user can write here.
 */

const PENDING = '.tmp'

/** Parses JSON text, ignoring the byte order mark Windows tools (PowerShell 5.1) put before UTF-8. */
export const parseJsonText = (text: string): unknown => JSON.parse(text.replace(/^﻿/, ''))

export function writeInboxEvent(dir: string, event: AgentEvent | ItemMessage): string {
  mkdirSync(dir, { recursive: true })
  const name = `${Date.now()}-${randomBytes(4).toString('hex')}.json`
  const tmp = join(dir, name + PENDING)
  writeFileSync(tmp, JSON.stringify(event), 'utf8')
  const final = join(dir, name)
  renameSync(tmp, final)
  return final
}

export interface InboxFile {
  readonly path: string
  readonly content: string
}

/** Finished files, oldest first (names start with a timestamp). */
export function readInbox(dir: string): InboxFile[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((n) => n.endsWith('.json'))
    .sort()
    .flatMap((n) => {
      const path = join(dir, n)
      try {
        return [{ path, content: readFileSync(path, 'utf8') }]
      } catch {
        return []
      }
    })
}

export function removeInboxFile(path: string): void {
  rmSync(path, { force: true })
}

/** Keeps a rejected file for inspection instead of silently dropping it. */
export function rejectInboxFile(dir: string, path: string): void {
  const rejected = join(dir, 'rejected')
  mkdirSync(rejected, { recursive: true })
  renameSync(path, join(rejected, path.split(/[\\/]/).at(-1)!))
}
