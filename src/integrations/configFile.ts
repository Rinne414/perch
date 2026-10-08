import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Every command we install contains this, so our entries can be found and removed again. */
export const MARKER = 'perch-hook'

/**
 * Hooks written before the app was renamed from "Tasks Calendar". They are still
 * recognised, reported as outdated, and replaced (never duplicated) on install.
 */
const LEGACY_MARKER = 'tasks-calendar-hook'

export const hasOurMarker = (text: string): boolean => text.includes(MARKER) || text.includes(LEGACY_MARKER)

export interface HookSetup {
  /** Absolute path of the built hook script (…/perch-hook.js). */
  readonly cliPath: string
  readonly inboxDir: string
  readonly home: string
}

export type Config = Record<string, unknown>

export const readText = (file: string | undefined): string => (file && existsSync(file) ? readFileSync(file, 'utf8') : '')

export function readJson(file: string): Config {
  if (!existsSync(file)) return {}
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '')
  if (!text.trim()) return {}
  const parsed = JSON.parse(text) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${file} is not a JSON object; left untouched`)
  }
  return parsed as Config
}

/** Writes via a temp file after keeping one backup of the previous version. */
export function writeSafely(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file)) copyFileSync(file, `${file}.perch.bak`)
  const tmp = `${file}.perch.tmp`
  writeFileSync(tmp, content, 'utf8')
  copyFileSync(tmp, file)
  rmSync(tmp, { force: true })
}
