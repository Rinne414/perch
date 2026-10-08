import { app, ipcMain, nativeImage } from 'electron'
import type { Server } from 'node:http'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { toDataURL } from 'qrcode'
import { CHANNELS } from '@shared/ipc'
import { PHONE_PORT, phoneAgent, phoneTodos, type PhoneSettingsPayload, type PhoneTarget } from '@shared/phone'
import { powerSummary, type PowerState } from '@shared/power'
import { setTailscaleServe, tailscaleState } from '../../integrations/tailscale'
import type { AppContext } from '../context'
import { getSetting, setSetting } from '../db/settings'
import { notify } from '../notify'
import { iconPath } from '../paths'
import { idleMinutes, type PowerControl } from '../power'
import { addTextClip } from '../services/clips'
import { captureText, getNowPayload } from '../services/now'
import { createPhoneApi, type PhoneApi, type PhonePowerActions } from '../services/phoneApi'
import { createPhoneAuth, type PhoneAuth } from '../services/phoneAuth'
import { timerAt } from '../services/power'
import { createPush, type PushMessage, type PushSender } from './push'
import { startPhoneServer } from './server'

const ENABLED = 'phoneEnabled'
const QR_WIDTH = 264

const isDev = (): boolean => !app.isPackaged
/** Development tests only: another port, and a fixed pairing code. */
const phonePort = (): number => {
  const port = Number(process.env['TC_PHONE_PORT'])
  return isDev() && Number.isInteger(port) && port > 1024 && port < 65536 ? port : PHONE_PORT
}
const devPairCode = (): string | undefined => (isDev() ? process.env['TC_PHONE_PAIR_CODE'] || undefined : undefined)

export interface PhoneControl {
  /** Sends a notification to every phone that turned them on (only while the phone link is on). */
  push(message: PushMessage): void
  stop(): void
}

/** Icons for the home screen, drawn from the app icon once per size. */
function iconMaker(): (size: number) => Buffer | null {
  const cache = new Map<number, Buffer>()
  return (size) => {
    const hit = cache.get(size)
    if (hit) return hit
    const png = nativeImage.createFromPath(iconPath()).resize({ width: size, height: size }).toPNG()
    if (png.length === 0) return null
    cache.set(size, png)
    return png
  }
}

/**
 * Shutdown actions from a phone. Each one is announced on the computer (and so on every phone
 * with notifications) with the phone's name, so a plan made from a lost or stolen phone shows.
 * 現在關機 needs no extra notice: its countdown names the phone itself.
 */
function phonePower(ctx: AppContext, power: PowerControl): PhonePowerActions {
  const announce = (title: string, state: PowerState): PowerState => {
    const body = state.plan ? powerSummary(state.plan, Date.now(), state.minuteMs).title : '電腦不會自動關機了'
    notify({ title, body }, () => ctx.showFloat())
    return state
  }
  return {
    timer: (when, now, by) => announce(`${by.name} 排了關機`, power.power.armTimer(timerAt(when, now, power.minuteMs), now)),
    gpu: (m, now, by) => announce(`${by.name} 排了關機`, power.power.armGpu(idleMinutes(m), now)),
    now: (now, by) => power.power.armTimer(now + power.minuteMs, now, `${by.name} 按了「現在關機」`),
    cancel: (by) => announce(`${by.name} 取消了關機`, power.power.cancel()),
  }
}

/** The phone's API, answered from the same data the float shows and the same shutdown planner. */
function phoneApiFor(ctx: AppContext, power: PowerControl, auth: PhoneAuth, pushes: PushSender): PhoneApi {
  const { db } = ctx
  const capture = (text: string, target: PhoneTarget, now: number): void => {
    // A line typed into 暫存 on the phone is a memo, kept like one typed on the computer.
    if (target === 'stash') addTextClip(db, text, now, { kept: true })
    else captureText(db, text, target, now, ctx.settings())
  }
  return createPhoneApi({
    auth,
    async snapshot(device, now) {
      const payload = getNowPayload(db, now, ctx.settings(), false)
      const state = power.power.state()
      return {
        now,
        computer: hostname(),
        day: payload.view.day,
        power: state,
        gpus: state.supported ? await power.power.readGpus(now) : null,
        attention: payload.view.attention.map((s) => phoneAgent(s, true)),
        running: payload.view.running.map((s) => phoneAgent(s, false)),
        today: phoneTodos(payload.view.today, payload.doneToday),
        notifications: device.notifications,
      }
    },
    capture,
    power: phonePower(ctx, power),
    vapidPublicKey: pushes.publicKey,
    changed: () => ctx.broadcast(),
    logError: (message, err) => ctx.log.error(message, err),
  })
}

interface PhoneLink {
  readonly port: number
  readonly auth: PhoneAuth
  isEnabled(): boolean
  /** Perch's own server is the one listening on the port. */
  isListening(): boolean
  setEnabled(on: boolean): Promise<void>
  /** Why the server is not running although switched on. */
  error(): string | null
}

async function settingsPayload(link: PhoneLink): Promise<PhoneSettingsPayload> {
  const tailscale = await tailscaleState(link.port)
  // No QR code unless Perch itself answers on the port: whatever else sits there would receive the code.
  const pairing = link.isListening() ? link.auth.pairing(Date.now()) : null
  const url = pairing && tailscale.kind === 'running' ? `https://${tailscale.dnsName}/#pair=${pairing.code}` : null
  return {
    enabled: link.isEnabled(),
    port: link.port,
    tailscale,
    devices: link.auth.devices(),
    pairing: pairing && { ...pairing, url, qr: url ? await toDataURL(url, { margin: 1, width: QR_WIDTH }) : null },
    error: link.isEnabled() ? link.error() : null,
  }
}

/** 設定 → 手機. */
function registerPhoneIpc(link: PhoneLink): void {
  const payload = (): Promise<PhoneSettingsPayload> => settingsPayload(link)
  ipcMain.handle(CHANNELS.getPhone, payload)
  ipcMain.handle(CHANNELS.setPhoneEnabled, async (_e, on: unknown) => {
    await link.setEnabled(on === true)
    return payload()
  })
  ipcMain.handle(CHANNELS.newPhoneCode, () => {
    link.auth.newCode(Date.now())
    return payload()
  })
  ipcMain.handle(CHANNELS.removePhone, (_e, id: unknown) => {
    if (typeof id === 'string') link.auth.remove(id)
    return payload()
  })
  ipcMain.handle(CHANNELS.setPhoneServe, async (_e, on: unknown) => {
    const problem = await setTailscaleServe(link.port, on === true)
    if (problem) throw new Error(problem)
    return payload()
  })
}

/**
 * The phone link: off until switched on in 設定 → 手機. Then a small HTTP server on 127.0.0.1
 * answers the phone page and its API, `tailscale serve` brings the phone in over HTTPS, and
 * every desktop notification is also pushed to phones that asked for notifications.
 */
export function startPhone(ctx: AppContext, power: PowerControl): PhoneControl {
  const { db, log } = ctx
  const port = phonePort()
  const auth = createPhoneAuth(db, devPairCode())
  const pushes = createPush(db, auth, log)
  const api = phoneApiFor(ctx, power, auth, pushes)
  const icon = iconMaker()
  let server: Server | null = null
  let error: string | null = null

  /** Stops Tailscale forwarding to the port, so phones reach nothing rather than something else. */
  const unforward = async (): Promise<void> => {
    const ts = await tailscaleState(port)
    if (ts.kind !== 'running' || !ts.serving) return
    const problem = await setTailscaleServe(port, false)
    if (problem) log.warn(`Could not turn off Tailscale forwarding: ${problem}`)
    else log.info('Tailscale forwarding to the phone link turned off')
  }
  const stop = (): void => {
    server?.close()
    server = null
  }
  const start = async (): Promise<void> => {
    if (server) return
    try {
      server = await startPhoneServer({ port, api, rendererDir: join(__dirname, '../renderer'), icon, logError: (m, e) => log.error(m, e) })
      error = null
      log.info(`Phone link listening on 127.0.0.1:${port}`)
    } catch (err) {
      error = `127.0.0.1:${port} 被別的程式占用了，手機連不進來；Tailscale 轉送已先關掉`
      log.error('The phone link could not start', err)
      await unforward()
    }
  }
  const isEnabled = (): boolean => getSetting(db, ENABLED, false)

  registerPhoneIpc({
    port,
    auth,
    isEnabled,
    isListening: () => server !== null,
    async setEnabled(on) {
      setSetting(db, ENABLED, on)
      if (on) return start()
      stop()
      await unforward()
    },
    error: () => error,
  })
  if (isEnabled()) void start()

  return {
    push(message) {
      if (server) pushes.send(message)
    },
    stop,
  }
}
