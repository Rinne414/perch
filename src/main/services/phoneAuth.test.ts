import { beforeEach, describe, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { PAIR_CODE_TTL_MS } from '@shared/phone'
import { openDatabase } from '../db/connection'
import { getSetting } from '../db/settings'
import { createPhoneAuth } from './phoneAuth'

const NOW = new Date(2026, 9, 5, 22, 0).getTime()
const PUSH = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BPx', auth: 'au' } }

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('pairing', () => {
  test('a code pairs one phone, once', () => {
    const auth = createPhoneAuth(db)
    const { code } = auth.newCode(NOW)
    const { key, deviceId } = auth.pair(code, '  Pixel   8 ', NOW + 1000)
    expect(auth.devices()).toEqual([{ id: deviceId, name: 'Pixel 8', pairedAt: NOW + 1000, lastSeenAt: NOW + 1000, notifications: false }])
    expect(auth.verify(key, NOW + 2000)?.id).toBe(deviceId)
    expect(() => auth.pair(code, 'Second', NOW + 3000)).toThrow('配對碼不對或過期了')
    expect(auth.pairing(NOW + 3000)).toBeNull()
  })

  test('a code expires and a new one replaces the old', () => {
    const auth = createPhoneAuth(db)
    const first = auth.newCode(NOW)
    expect(() => auth.pair(first.code, 'Pixel', NOW + PAIR_CODE_TTL_MS)).toThrow()
    const old = auth.newCode(NOW)
    auth.newCode(NOW + 1)
    expect(() => auth.pair(old.code, 'Pixel', NOW + 2)).toThrow()
  })

  test('a wrong code or an empty name pairs nothing', () => {
    const auth = createPhoneAuth(db)
    const { code } = auth.newCode(NOW)
    expect(() => auth.pair(code.slice(1), 'Pixel', NOW)).toThrow()
    expect(() => auth.pair(code, '   ', NOW)).toThrow('取個名字')
    expect(auth.devices()).toEqual([])
    expect(auth.pair(code, 'Pixel', NOW).key).toBeTruthy()
  })

  test('only a hash of the key is stored', () => {
    const auth = createPhoneAuth(db)
    const { key } = auth.pair(auth.newCode(NOW).code, 'Pixel', NOW)
    expect(JSON.stringify(getSetting(db, 'phoneDevices', []))).not.toContain(key)
  })
})

describe('phone keys', () => {
  test('an unknown or removed key opens nothing', () => {
    const auth = createPhoneAuth(db)
    const { key, deviceId } = auth.pair(auth.newCode(NOW).code, 'Pixel', NOW)
    expect(auth.verify('', NOW)).toBeNull()
    expect(auth.verify(`${key}x`, NOW)).toBeNull()
    auth.remove(deviceId)
    expect(auth.verify(key, NOW)).toBeNull()
  })

  test('the last-seen time is written at most once a minute', () => {
    const auth = createPhoneAuth(db)
    const { key } = auth.pair(auth.newCode(NOW).code, 'Pixel', NOW)
    auth.verify(key, NOW + 30_000)
    expect(auth.devices()[0].lastSeenAt).toBe(NOW)
    auth.verify(key, NOW + 61_000)
    expect(auth.devices()[0].lastSeenAt).toBe(NOW + 61_000)
  })

  test('push targets follow each phone', () => {
    const auth = createPhoneAuth(db)
    const a = auth.pair(auth.newCode(NOW).code, 'A', NOW)
    auth.pair(auth.newCode(NOW).code, 'B', NOW)
    auth.setPush(a.deviceId, PUSH)
    expect(auth.pushTargets()).toEqual([{ id: a.deviceId, push: PUSH }])
    expect(auth.devices().map((d) => d.notifications)).toEqual([true, false])
    auth.setPush(a.deviceId, null)
    expect(auth.pushTargets()).toEqual([])
  })
})
