/** The key this phone got when it paired; kept on the phone only. */
const KEY = 'perch.phoneKey'

export function storedKey(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function saveKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(KEY, key)
    else localStorage.removeItem(KEY)
  } catch {
    // Without storage the phone pairs again next time; nothing else depends on it.
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** No answer at all: the computer is off or asleep, Perch is closed, or Tailscale is off on one side. */
export const OFFLINE = '連不上電腦：電腦可能關著或睡著、Perch 沒開，或手機的 Tailscale 沒開'

/** Calls the computer's API with this phone's key; rejects with an ApiError carrying its message. */
export async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const key = storedKey()
  let res: Response
  try {
    res = await fetch(path, {
      method,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, OFFLINE)
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ApiError(res.status, json.error ?? OFFLINE)
  return json as T
}

export const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))
