import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { cleanPhoneName, PAIR_CODE_TTL_MS, type PhoneDevice } from '@shared/phone'
import { getSetting, setSetting } from '../db/settings'

const DEVICES = 'phoneDevices'
const KEY_BYTES = 32
const CODE_BYTES = 16
/** Seen-times are written at most this often, so a phone polling every few seconds does not write every time. */
const SEEN_WRITE_MS = 60_000

/** A browser push subscription as the phone sends it (PushSubscription.toJSON()). */
export interface PushTarget {
  readonly endpoint: string
  readonly keys: { readonly p256dh: string; readonly auth: string }
}

interface StoredDevice {
  readonly id: string
  readonly name: string
  /** sha256 of the phone's key; the key itself is never stored. */
  readonly keyHash: string
  readonly pairedAt: number
  readonly lastSeenAt: number | null
  readonly push: PushTarget | null
}

export interface Pairing {
  readonly code: string
  readonly expiresAt: number
}

export interface PhoneAuth {
  /** A new one-time pairing code; the previous one stops working. */
  newCode(now: number): Pairing
  /** The code still waiting to be used, if any. */
  pairing(now: number): Pairing | null
  /** Trades a valid code for a key that only this phone holds; a code that paired once never works again. */
  pair(code: string, name: unknown, now: number): { readonly deviceId: string; readonly key: string }
  /** The phone a key belongs to, or null. */
  verify(key: string, now: number): PhoneDevice | null
  devices(): PhoneDevice[]
  remove(id: string): void
  setPush(id: string, push: PushTarget | null): void
  pushTargets(): { readonly id: string; readonly push: PushTarget }[]
}

/** A pairing that cannot go ahead; the message is written for the person holding the phone. */
export class PairError extends Error {}

const hashOf = (secret: string): string => createHash('sha256').update(secret).digest('hex')

/** Constant-time comparison of two strings (different lengths are simply unequal). */
function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const publicView = (d: StoredDevice): PhoneDevice => ({
  id: d.id,
  name: d.name,
  pairedAt: d.pairedAt,
  lastSeenAt: d.lastSeenAt,
  notifications: d.push !== null,
})

/**
 * Pairing and phone keys. A pairing code lives in memory only (a restart voids it) and works
 * once; each phone then holds its own random key, of which only a hash is kept, so removing a
 * phone in 設定 locks it out for good. `fixedCode` is for development tests only.
 */
export function createPhoneAuth(db: DatabaseSync, fixedCode?: string): PhoneAuth {
  let current: Pairing | null = fixedCode ? { code: fixedCode, expiresAt: Number.MAX_SAFE_INTEGER } : null

  const load = (): StoredDevice[] => getSetting<StoredDevice[]>(db, DEVICES, [])
  const save = (devices: readonly StoredDevice[]): void => setSetting(db, DEVICES, devices)
  const update = (id: string, change: (d: StoredDevice) => StoredDevice): void =>
    save(load().map((d) => (d.id === id ? change(d) : d)))

  return {
    newCode(now) {
      current = { code: randomBytes(CODE_BYTES).toString('base64url'), expiresAt: now + PAIR_CODE_TTL_MS }
      return current
    },
    pairing(now) {
      return current && now < current.expiresAt ? current : null
    },
    pair(code, name, now) {
      const valid = current !== null && now < current.expiresAt && sameSecret(code, current.code)
      if (!valid) throw new PairError('配對碼不對或過期了，請在電腦的 設定 → 手機 換一個再掃')
      const cleanName = cleanPhoneName(name)
      if (!cleanName) throw new PairError('請幫這支手機取個名字')
      current = null
      const key = randomBytes(KEY_BYTES).toString('base64url')
      const device: StoredDevice = { id: randomUUID(), name: cleanName, keyHash: hashOf(key), pairedAt: now, lastSeenAt: now, push: null }
      save([...load(), device])
      return { deviceId: device.id, key }
    },
    verify(key, now) {
      if (!key) return null
      const hash = hashOf(key)
      const found = load().find((d) => sameSecret(d.keyHash, hash))
      if (!found) return null
      if (found.lastSeenAt === null || now - found.lastSeenAt >= SEEN_WRITE_MS) {
        update(found.id, (d) => ({ ...d, lastSeenAt: now }))
        return publicView({ ...found, lastSeenAt: now })
      }
      return publicView(found)
    },
    devices: () => load().map(publicView),
    remove(id) {
      save(load().filter((d) => d.id !== id))
    },
    setPush(id, push) {
      update(id, (d) => ({ ...d, push }))
    },
    pushTargets() {
      return load().flatMap((d) => (d.push ? [{ id: d.id, push: d.push }] : []))
    },
  }
}
