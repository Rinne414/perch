import { agentName, STATUS_LABEL } from './agents'
import type { TodayEntry } from './now'
import type { GpuReading, PowerState } from './power'
import type { AgentSession, AgentStatus, Item } from './types'

/** Where Perch listens for the phone, on 127.0.0.1 only; `tailscale serve` brings the phone in. */
export const PHONE_PORT = 47817
/** A pairing code (in the QR code) works once, for this long. */
export const PAIR_CODE_TTL_MS = 10 * 60_000
export const MAX_PHONE_NAME = 40
export const MAX_PHONE_TEXT = 2000

/** Where a line typed on the phone goes: today's list, 隨手記, or 暫存 (kept as a memo). */
export type PhoneTarget = 'today' | 'inbox' | 'stash'
export const PHONE_TARGETS: readonly PhoneTarget[] = ['today', 'inbox', 'stash']

export interface PhoneAgent {
  readonly id: string
  /** "Claude Code" */
  readonly agent: string
  /** The folder's last part ("perch"), or null when the agent did not say. */
  readonly project: string | null
  readonly status: AgentStatus
  readonly statusLabel: string
  /** What it was asked, short. */
  readonly title: string | null
  /** When it started waiting (attention) or last reported (running). */
  readonly at: number
}

export interface PhoneTodo {
  readonly id: string
  readonly title: string
  readonly done: boolean
  readonly overdueDays: number
  /** A due time to show, or when it was done; null for neither. */
  readonly at: number | null
}

/** Everything the phone's 現在 page shows, in one answer. */
export interface PhoneSnapshot {
  /** The computer's clock, so the phone can count down without trusting its own. */
  readonly now: number
  readonly computer: string
  readonly day: string
  readonly power: PowerState
  readonly gpus: readonly GpuReading[] | null
  readonly attention: readonly PhoneAgent[]
  readonly running: readonly PhoneAgent[]
  readonly today: readonly PhoneTodo[]
  /** Whether this phone gets push notifications. */
  readonly notifications: boolean
}

/** A paired phone as the computer's 設定 lists it. */
export interface PhoneDevice {
  readonly id: string
  readonly name: string
  readonly pairedAt: number
  readonly lastSeenAt: number | null
  readonly notifications: boolean
}

export type TailscaleState =
  | { readonly kind: 'missing' }
  | { readonly kind: 'stopped'; readonly detail: string }
  | {
      readonly kind: 'running'
      readonly dnsName: string
      readonly serving: boolean
      /** Tailscale Funnel would put Perch on the public internet; 設定 warns about it. */
      readonly funnel: boolean
    }

export interface PhonePairing {
  readonly code: string
  readonly expiresAt: number
  /** The address the QR code opens; null until Tailscale has a name for this computer. */
  readonly url: string | null
  /** The QR code as a PNG data URL; null without a url. */
  readonly qr: string | null
}

/** What 設定 → 手機 shows. */
export interface PhoneSettingsPayload {
  readonly enabled: boolean
  readonly port: number
  readonly tailscale: TailscaleState
  readonly devices: readonly PhoneDevice[]
  readonly pairing: PhonePairing | null
  /** Why the phone server is not running although switched on (port taken). */
  readonly error: string | null
}

/** "perch" from "D:\\code\\perch" or "/home/me/perch/". */
export function projectOf(cwd: string | null): string | null {
  if (!cwd) return null
  const parts = cwd.split(/[\\/]+/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : null
}

export function phoneAgent(s: AgentSession, attention: boolean): PhoneAgent {
  return {
    id: s.id,
    agent: agentName(s.agent),
    project: projectOf(s.cwd),
    status: s.status,
    statusLabel: STATUS_LABEL[s.status],
    title: s.title,
    at: attention ? (s.attentionAt ?? s.updatedAt) : s.updatedAt,
  }
}

/** Today's open work (as the float sorts it), then what got done today. */
export function phoneTodos(today: readonly TodayEntry[], doneToday: readonly Item[]): PhoneTodo[] {
  const open = today.map((e) => ({
    id: e.item.id,
    title: e.item.title,
    done: false,
    overdueDays: e.overdueDays,
    at: e.item.dueAt !== null && e.item.dueHasTime ? e.item.dueAt : null,
  }))
  const done = doneToday.map((i) => ({ id: i.id, title: i.title, done: true, overdueDays: 0, at: i.doneAt }))
  return [...open, ...done]
}

/** A phone name as typed: one line, trimmed, at most 40 characters; null when nothing is left. */
export function cleanPhoneName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const one = name.replace(/\s+/g, ' ').trim().slice(0, MAX_PHONE_NAME)
  return one || null
}
