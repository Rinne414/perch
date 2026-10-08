import { MAX_PHONE_TEXT, PHONE_TARGETS, type PhoneDevice, type PhoneSnapshot, type PhoneTarget } from '@shared/phone'
import type { PowerState } from '@shared/power'
import { PairError, type PhoneAuth, type PushTarget } from './phoneAuth'
import { PlanError } from './power'

export interface ApiRequest {
  readonly method: string
  readonly path: string
  readonly authorization: string | undefined
  readonly body: unknown
}

export interface ApiResponse {
  readonly status: number
  readonly body: unknown
}

/** Each action names the phone it came from, so the computer can say who planned or cancelled a shutdown. */
export interface PhonePowerActions {
  timer(when: unknown, now: number, by: PhoneDevice): PowerState
  gpu(idleMinutes: unknown, now: number, by: PhoneDevice): PowerState
  /** 現在關機: the one-minute countdown starts at once. */
  now(now: number, by: PhoneDevice): PowerState
  cancel(by: PhoneDevice): PowerState
}

export interface PhoneApiDeps {
  readonly auth: PhoneAuth
  snapshot(device: PhoneDevice, now: number): Promise<PhoneSnapshot>
  capture(text: string, target: PhoneTarget, now: number): void
  readonly power: PhonePowerActions
  vapidPublicKey(): string
  /** Something changed that the computer's windows show. */
  changed(): void
  /** Unexpected failures are logged here; the phone only hears that something went wrong. */
  logError(message: string, err: unknown): void
}

/** Failed pairing attempts allowed per minute; codes are 128-bit, so this only stops a flood. */
const PAIR_FAILURES_PER_MINUTE = 10
const MINUTE_MS = 60_000
const MAX_ENDPOINT = 1024
const MAX_PUSH_KEY = 256
const BASE64URL = /^[A-Za-z0-9_-]+=*$/
/** Perch posts to the endpoint a phone gives it, so only real push services are accepted. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/]
const BEARER = /^Bearer ([A-Za-z0-9_-]{20,100})$/

/** A message meant for the person holding the phone. */
class PhoneError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body })
const failure = (status: number, error: string): ApiResponse => ({ status, body: { error } })
const record = (body: unknown): Record<string, unknown> => (typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {})

function phoneText(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw new PhoneError(400, '沒有寫東西')
  if (v.length > MAX_PHONE_TEXT) throw new PhoneError(400, `太長了，最多 ${MAX_PHONE_TEXT} 字`)
  return v
}

function phoneTarget(v: unknown): PhoneTarget {
  if (!PHONE_TARGETS.includes(v as PhoneTarget)) throw new PhoneError(400, '要記到今天、隨手記或暫存')
  return v as PhoneTarget
}

/** A browser PushSubscription.toJSON() pointing at a known push service. */
export function pushTarget(v: unknown): PushTarget {
  const sub = record(v)
  const keys = record(sub['keys'])
  const { endpoint } = sub
  const { p256dh, auth } = keys
  const isKey = (k: unknown): k is string => typeof k === 'string' && k.length > 0 && k.length <= MAX_PUSH_KEY && BASE64URL.test(k)
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT || !isKey(p256dh) || !isKey(auth)) {
    throw new PhoneError(400, '通知的訂閱資料不完整')
  }
  let url: URL | null = null
  try {
    url = new URL(endpoint)
  } catch {
    url = null
  }
  // The address is checked and then stored in its parsed form, so the push library reads exactly what was checked.
  const plain = url !== null && url.protocol === 'https:' && !url.username && !url.password && url.port === ''
  if (!url || !plain || !PUSH_HOSTS.some((h) => h.test(url.hostname))) throw new PhoneError(400, '不認得這個推播服務')
  return { endpoint: url.href, keys: { p256dh, auth } }
}

/** A plan the planner refuses comes back to the phone with its message; anything else is unexpected. */
function powerAction(body: unknown, power: PhonePowerActions, now: number, by: PhoneDevice): PowerState {
  const b = record(body)
  try {
    if (b['action'] === 'timer') return power.timer(b, now, by)
    if (b['action'] === 'gpu') return power.gpu(b['idleMinutes'], now, by)
    if (b['action'] === 'now') return power.now(now, by)
    if (b['action'] === 'cancel') return power.cancel(by)
  } catch (err) {
    if (err instanceof PlanError) throw new PhoneError(400, err.message)
    throw err
  }
  throw new PhoneError(400, '不認得這個關機動作')
}

async function route(req: ApiRequest, device: PhoneDevice, deps: PhoneApiDeps, now: number): Promise<ApiResponse> {
  const key = `${req.method} ${req.path}`
  if (key === 'GET /api/state') return ok(await deps.snapshot(device, now))
  if (key === 'GET /api/push') return ok({ publicKey: deps.vapidPublicKey() })
  if (key === 'POST /api/capture') {
    const b = record(req.body)
    deps.capture(phoneText(b['text']), phoneTarget(b['target']), now)
  } else if (key === 'POST /api/power') {
    const state = powerAction(req.body, deps.power, now, device)
    deps.changed()
    return ok(state)
  } else if (key === 'POST /api/push') {
    deps.auth.setPush(device.id, pushTarget(record(req.body)['subscription']))
  } else if (key === 'DELETE /api/push') {
    deps.auth.setPush(device.id, null)
  } else if (key === 'POST /api/unpair') {
    deps.auth.remove(device.id)
  } else {
    return failure(404, '沒有這個功能')
  }
  deps.changed()
  return ok({ ok: true })
}

export interface PhoneApi {
  handle(req: ApiRequest, now: number): Promise<ApiResponse>
}

/**
 * The phone's JSON API. Every call except pairing needs the phone's own key; pairing failures
 * are limited per minute. Messages for the person come back as `{ error }`; anything
 * unexpected is logged here and the phone only hears that something went wrong.
 */
export function createPhoneApi(deps: PhoneApiDeps): PhoneApi {
  let failures: number[] = []

  const pair = (body: unknown, now: number): ApiResponse => {
    failures = failures.filter((t) => now - t < MINUTE_MS)
    if (failures.length >= PAIR_FAILURES_PER_MINUTE) return failure(429, '試太多次了，請一分鐘後再試')
    const b = record(body)
    try {
      const paired = deps.auth.pair(typeof b['code'] === 'string' ? b['code'] : '', b['name'], now)
      deps.changed()
      return ok(paired)
    } catch (err) {
      if (!(err instanceof PairError)) throw err
      failures.push(now)
      return failure(403, err.message)
    }
  }

  return {
    async handle(req, now) {
      try {
        if (req.method === 'POST' && req.path === '/api/pair') return pair(req.body, now)
        const key = BEARER.exec(req.authorization ?? '')?.[1] ?? ''
        const device = deps.auth.verify(key, now)
        if (!device) return failure(401, '這支手機還沒配對，或已經在電腦上被移除了')
        return await route(req, device, deps, now)
      } catch (err) {
        if (err instanceof PhoneError) return failure(err.status, err.message)
        deps.logError(`Phone request ${req.method} ${req.path} failed`, err)
        return failure(500, '電腦那邊出錯了，請再試一次')
      }
    },
  }
}
