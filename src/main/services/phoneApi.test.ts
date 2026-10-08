import { beforeEach, describe, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type { PhoneSnapshot, PhoneTarget } from '@shared/phone'
import type { PowerState } from '@shared/power'
import { openDatabase } from '../db/connection'
import { createPhoneApi, pushTarget, type ApiRequest, type PhoneApi } from './phoneApi'
import { createPhoneAuth, type PhoneAuth } from './phoneAuth'
import { PlanError } from './power'

const NOW = new Date(2026, 9, 5, 22, 0).getTime()
const STATE: PowerState = { supported: true, plan: null, countdownEndsAt: null, minuteMs: 60_000 }
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BPxk_1', auth: 'au-th' } }

let db: DatabaseSync
let auth: PhoneAuth
let api: PhoneApi
let captured: [string, PhoneTarget][]
let powerCalls: string[]
let errors: string[]
let key: string

const req = (method: string, path: string, body: unknown = null, withKey = true): ApiRequest => ({
  method,
  path,
  authorization: withKey ? `Bearer ${key}` : undefined,
  body,
})

beforeEach(() => {
  db = openDatabase(':memory:')
  auth = createPhoneAuth(db)
  captured = []
  powerCalls = []
  errors = []
  api = createPhoneApi({
    auth,
    snapshot: async (device) => ({ computer: 'PC', notifications: device.notifications }) as unknown as PhoneSnapshot,
    capture: (text, target) => captured.push([text, target]),
    power: {
      timer: (when, _now, by) => {
        powerCalls.push(`timer ${JSON.stringify(when)} by ${by.name}`)
        const clock = (when as { clock?: string }).clock
        if (clock === 'nope') throw new PlanError('看不懂這個時間')
        if (clock === 'boom') throw new Error('SQLITE_FULL at L:\data')
        return STATE
      },
      gpu: (m, _now, by) => (powerCalls.push(`gpu ${String(m)} by ${by.name}`), STATE),
      now: (_now, by) => (powerCalls.push(`now by ${by.name}`), STATE),
      cancel: (by) => (powerCalls.push(`cancel by ${by.name}`), STATE),
    },
    vapidPublicKey: () => 'PUBLIC',
    changed: () => undefined,
    logError: (message) => errors.push(message),
  })
  key = auth.pair(auth.newCode(NOW).code, 'Pixel', NOW).key
})

describe('phone API', () => {
  test('pairing with the code from the QR code returns a key', async () => {
    const { code } = auth.newCode(NOW)
    const res = await api.handle(req('POST', '/api/pair', { code, name: 'Pixel 8' }, false), NOW)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ key: expect.any(String), deviceId: expect.any(String) })
  })

  test('without a valid key nothing but pairing answers', async () => {
    for (const r of [req('GET', '/api/state', null, false), { ...req('GET', '/api/state'), authorization: 'Bearer short' }]) {
      expect((await api.handle(r, NOW)).status).toBe(401)
    }
    expect((await api.handle(req('POST', '/api/power', { action: 'now' }, false), NOW)).status).toBe(401)
    expect(powerCalls).toEqual([])
  })

  test('too many wrong pairing codes are turned away for a minute', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await api.handle(req('POST', '/api/pair', { code: 'x', name: 'A' }, false), NOW)).status).toBe(403)
    }
    const { code } = auth.newCode(NOW)
    expect((await api.handle(req('POST', '/api/pair', { code, name: 'A' }, false), NOW + 1000)).status).toBe(429)
    expect((await api.handle(req('POST', '/api/pair', { code, name: 'A' }, false), NOW + 61_000)).status).toBe(200)
  })

  test('captures go where the phone said, and odd input is refused', async () => {
    expect((await api.handle(req('POST', '/api/capture', { text: '明天 交報告', target: 'today' }), NOW)).status).toBe(200)
    expect((await api.handle(req('POST', '/api/capture', { text: 'memo', target: 'stash' }), NOW)).status).toBe(200)
    expect((await api.handle(req('POST', '/api/capture', { text: '  ', target: 'today' }), NOW)).status).toBe(400)
    expect((await api.handle(req('POST', '/api/capture', { text: 'x', target: 'calendar' }), NOW)).status).toBe(400)
    expect((await api.handle(req('POST', '/api/capture', { text: 'x'.repeat(2001), target: 'inbox' }), NOW)).status).toBe(400)
    expect(captured).toEqual([
      ['明天 交報告', 'today'],
      ['memo', 'stash'],
    ])
  })

  test('power actions reach the planner, and its messages come back to the phone', async () => {
    await api.handle(req('POST', '/api/power', { action: 'gpu', idleMinutes: 5 }), NOW)
    await api.handle(req('POST', '/api/power', { action: 'now' }), NOW)
    await api.handle(req('POST', '/api/power', { action: 'cancel' }), NOW)
    const bad = await api.handle(req('POST', '/api/power', { action: 'timer', clock: 'nope' }), NOW)
    expect(bad).toEqual({ status: 400, body: { error: '看不懂這個時間' } })
    expect((await api.handle(req('POST', '/api/power', { action: 'reboot' }), NOW)).status).toBe(400)
    expect(powerCalls).toEqual(['gpu 5 by Pixel', 'now by Pixel', 'cancel by Pixel', 'timer {"action":"timer","clock":"nope"} by Pixel'])
    const broken = await api.handle(req('POST', '/api/power', { action: 'timer', clock: 'boom' }), NOW)
    expect(broken).toEqual({ status: 500, body: { error: '電腦那邊出錯了，請再試一次' } })
    expect(errors).toEqual(['Phone request POST /api/power failed'])
  })

  test('notifications are switched on and off per phone', async () => {
    expect((await api.handle(req('GET', '/api/push'), NOW)).body).toEqual({ publicKey: 'PUBLIC' })
    expect((await api.handle(req('POST', '/api/push', { subscription: SUB }), NOW)).status).toBe(200)
    expect(auth.pushTargets()).toHaveLength(1)
    expect((await api.handle(req('DELETE', '/api/push'), NOW)).status).toBe(200)
    expect(auth.pushTargets()).toHaveLength(0)
  })

  test('a phone can unpair itself', async () => {
    expect((await api.handle(req('POST', '/api/unpair'), NOW)).status).toBe(200)
    expect((await api.handle(req('GET', '/api/state'), NOW)).status).toBe(401)
  })

  test('unexpected failures are logged and not shown', async () => {
    const broken = createPhoneApi({
      auth,
      snapshot: async () => {
        throw new Error('SQLITE_BUSY at L:\\secret\\path')
      },
      capture: () => undefined,
      power: { timer: () => STATE, gpu: () => STATE, now: () => STATE, cancel: () => STATE },
      vapidPublicKey: () => '',
      changed: () => undefined,
      logError: (message) => errors.push(message),
    })
    const res = await broken.handle(req('GET', '/api/state'), NOW)
    expect(res).toEqual({ status: 500, body: { error: '電腦那邊出錯了，請再試一次' } })
    expect(errors).toEqual(['Phone request GET /api/state failed'])
  })

  test('a failure while saving a pairing is not shown to the phone nor counted as a wrong code', async () => {
    const failing = { ...auth, pair: () => { throw new Error('SQLITE_FULL at L:\\secret\\tasks.db') } }
    const broken = createPhoneApi({
      auth: failing,
      snapshot: async () => ({}) as PhoneSnapshot,
      capture: () => undefined,
      power: { timer: () => STATE, gpu: () => STATE, now: () => STATE, cancel: () => STATE },
      vapidPublicKey: () => '',
      changed: () => undefined,
      logError: (message) => errors.push(message),
    })
    const res = await broken.handle(req('POST', '/api/pair', { code: 'x', name: 'A' }, false), NOW)
    expect(res).toEqual({ status: 500, body: { error: '電腦那邊出錯了，請再試一次' } })
    expect(errors).toEqual(['Phone request POST /api/pair failed'])
  })

  test('unknown paths are 404', async () => {
    expect((await api.handle(req('GET', '/api/secrets'), NOW)).status).toBe(404)
  })
})

describe('push subscriptions', () => {
  test('only real push services are accepted', () => {
    expect(pushTarget(SUB)).toEqual(SUB)
    const at = (endpoint: string): unknown => ({ ...SUB, endpoint })
    expect(pushTarget({ ...SUB, endpoint: 'https://FCM.googleapis.com/fcm/send/abc' }).endpoint).toBe('https://fcm.googleapis.com/fcm/send/abc')
    for (const bad of ['http://fcm.googleapis.com/x', 'https://127.0.0.1:47817/api/power', 'https://evil.example/fcm.googleapis.com', 'not a url', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x']) {
      expect(() => pushTarget(at(bad))).toThrow()
    }
    expect(() => pushTarget({ endpoint: SUB.endpoint, keys: { p256dh: 'a b', auth: 'x' } })).toThrow()
  })
})
