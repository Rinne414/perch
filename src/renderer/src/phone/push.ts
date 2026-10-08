import { call } from './api'

/** Chrome on Android has all three on an HTTPS page (the Tailscale address). */
export const canPush = (): boolean => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** The VAPID public key (base64url) as the bytes PushManager.subscribe wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Asks for permission (must follow a tap), subscribes, and tells the computer where to push. */
export async function enablePush(): Promise<void> {
  if (!canPush()) throw new Error('這個瀏覽器收不到通知：請用 Chrome 打開，並從 Tailscale 的網址進來')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('沒有允許通知：到 Chrome 的網站設定把通知打開')
  const registration = await navigator.serviceWorker.ready
  const { publicKey } = await call<{ publicKey: string }>('GET', '/api/push')
  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }))
  await call('POST', '/api/push', { subscription: subscription.toJSON() })
}

export async function disablePush(): Promise<void> {
  if (canPush()) {
    const registration = await navigator.serviceWorker.ready
    await (await registration.pushManager.getSubscription())?.unsubscribe()
  }
  await call('DELETE', '/api/push')
}
