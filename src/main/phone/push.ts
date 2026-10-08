import type { DatabaseSync } from 'node:sqlite'
import { generateVAPIDKeys, sendNotification, WebPushError } from 'web-push'
import { getSetting, setSetting } from '../db/settings'
import type { Log } from '../log'
import type { PhoneAuth } from '../services/phoneAuth'

const VAPID = 'phoneVapid'
/** The VAPID contact push services may use; the project page, not anyone's email. */
const SUBJECT = 'https://github.com/Rinne414/perch'
/** A notification older than this is no longer worth showing. */
const TTL_SECONDS = 3600
const TIMEOUT_MS = 10_000
/** The push service says the subscription is gone: the phone unsubscribed or was reset. */
const GONE = new Set([404, 410])

interface VapidKeys {
  readonly publicKey: string
  readonly privateKey: string
}

export interface PushMessage {
  readonly title: string
  readonly body: string
}

export interface PushSender {
  /** The key phones subscribe with (applicationServerKey). */
  publicKey(): string
  /** Sends to every phone that turned notifications on; never throws. */
  send(message: PushMessage): void
}

/**
 * Web Push from this computer: the VAPID key pair is made once and kept in the local database.
 * Payloads are encrypted for each phone, so the push service (Google's, for Chrome on Android)
 * carries them without reading them.
 */
export function createPush(db: DatabaseSync, auth: PhoneAuth, log: Log): PushSender {
  let keys = getSetting<VapidKeys | null>(db, VAPID, null)
  if (!keys) {
    keys = generateVAPIDKeys()
    setSetting(db, VAPID, keys)
  }
  const vapidDetails = { subject: SUBJECT, publicKey: keys.publicKey, privateKey: keys.privateKey }

  return {
    publicKey: () => vapidDetails.publicKey,
    send(message) {
      const payload = JSON.stringify(message)
      for (const { id, push } of auth.pushTargets()) {
        sendNotification(push, payload, { vapidDetails, TTL: TTL_SECONDS, urgency: 'high', timeout: TIMEOUT_MS }).catch(
          (err: unknown) => {
            if (err instanceof WebPushError && GONE.has(err.statusCode)) {
              auth.setPush(id, null)
              log.info(`Push subscription ${id} is gone; notifications for it were turned off`)
            } else {
              log.warn(`Push to phone ${id} failed: ${err instanceof Error ? err.message : String(err)}`)
            }
          },
        )
      }
    },
  }
}
