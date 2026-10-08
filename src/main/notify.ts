import { Notification } from 'electron'
import type { Alert } from './services/reminders'

// Windows drops click handlers of notifications that get garbage-collected.
const live = new Set<Notification>()

let mirror: ((alert: Alert) => void) | null = null

/** Every notification is also handed to `listener` (the phone link pushes it to phones). */
export function mirrorNotifications(listener: ((alert: Alert) => void) | null): void {
  mirror = listener
}

export function notify(alert: Alert, onClick: () => void): void {
  mirror?.(alert)
  if (!Notification.isSupported()) return
  const n = new Notification({ title: alert.title, body: alert.body })
  live.add(n)
  n.on('click', () => {
    live.delete(n)
    onClick()
  })
  n.on('close', () => live.delete(n))
  n.show()
}
