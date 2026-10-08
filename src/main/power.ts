import { app, BrowserWindow, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHANNELS } from '@shared/ipc'
import { countdownReason, MINUTE_MS, type PowerPlan, type PowerState } from '@shared/power'
import { readNvidiaGpus } from '../integrations/gpu'
import type { AppContext } from './context'
import { appendEvent, deleteEvent } from './db/events'
import { notify } from './notify'
import { dataDir } from './paths'
import { createPower, PlanError, timerAt, type Power } from './services/power'
import { createOffWindow } from './windows/off'

/** How often an armed plan is checked; the GPU itself is read less often (`gpuPollMs`). */
const POLL_MS = 1_000

const isDev = (): boolean => !app.isPackaged
/** Development tests only: a shorter "minute", and a file standing in for nvidia-smi. */
const devMinuteMs = (): number => {
  const ms = Number(process.env['TC_POWER_MINUTE_MS'])
  return isDev() && Number.isInteger(ms) && ms >= 200 ? ms : MINUTE_MS
}
const devGpuFile = (): string | undefined => (isDev() ? process.env['TC_GPU_FAKE'] || undefined : undefined)

/**
 * `shutdown /s /t 0`: a normal shutdown. Not `/t 60` — any timeout above 0 makes Windows add
 * `/f`, which closes programs without letting them save. A development run only writes a line
 * to `<data>/shutdown-fake.log`, unless TC_SHUTDOWN_REAL=1.
 */
function systemShutdown(): Promise<void> {
  if (isDev() && process.env['TC_SHUTDOWN_REAL'] !== '1') {
    appendFileSync(join(dataDir(), 'shutdown-fake.log'), `${new Date().toISOString()} shutdown /s /t 0\n`)
    return Promise.resolve()
  }
  const exe = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'shutdown.exe')
  return new Promise((resolve, reject) => {
    // shutdown.exe writes its errors in the console code page, so only its exit code is passed on.
    execFile(exe, ['/s', '/t', '0'], { windowsHide: true }, (err) => {
      if (err) reject(new Error(`Windows 沒有接受關機指令（代碼 ${err.code ?? '?'}）`))
      else resolve()
    })
  })
}

export function idleMinutes(v: unknown): number {
  if (typeof v !== 'number') throw new PlanError('閒置分鐘數只能選 3、5、10、15')
  return v
}

export interface PowerControl {
  readonly power: Power
  /** One "minute" in milliseconds (shorter only in development tests). */
  readonly minuteMs: number
  stop(): void
}

/**
 * Wires the shutdown planner to the app: IPC for the panel, the countdown window, notifications,
 * the timeline, and `onState` for the tray. Polls only while something is planned.
 */
export function startPower(ctx: AppContext, onState: (state: PowerState) => void): PowerControl {
  let offWin: BrowserWindow | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  const minuteMs = devMinuteMs()
  const gpuFile = devGpuFile()

  /** No visible countdown means no warning, so no shutdown either. */
  const countdownFailed = (why: unknown): void => {
    ctx.log.error('The countdown window failed', why)
    if (power.state().countdownEndsAt === null) return
    power.cancel()
    notify({ title: '關機取消了', body: '倒數視窗打不開，所以這次不關。' }, () => ctx.showFloat())
  }

  const showCountdown = (): void => {
    if (offWin && !offWin.isDestroyed()) {
      offWin.show()
      offWin.focus()
      return
    }
    let win: BrowserWindow
    try {
      win = createOffWindow(countdownFailed)
    } catch (err) {
      countdownFailed(err)
      return
    }
    offWin = win
    // Closing the countdown some other way (Alt+F4) counts as 取消, never as 關.
    win.on('closed', () => {
      if (offWin !== win) return
      offWin = null
      if (power.state().countdownEndsAt !== null) power.cancel()
    })
  }
  const closeCountdown = (): void => {
    const win = offWin
    offWin = null
    if (win && !win.isDestroyed()) win.destroy()
  }

  const power = createPower({
    supported: process.platform === 'win32',
    minuteMs,
    gpuPollMs: Math.round(minuteMs / 4),
    readGpus: () => readNvidiaGpus(gpuFile),
    shutdown: systemShutdown,
    record: (plan: PowerPlan) => {
      const now = Date.now()
      const reason = countdownReason(plan, now)
      ctx.log.info(`Shutting down: ${reason}`)
      try {
        const event = appendEvent(ctx.db, { at: now, type: 'power.off', title: '關機', source: 'user', data: { reason } })
        ctx.broadcast()
        return () => {
          deleteEvent(ctx.db, event.id)
          ctx.broadcast()
        }
      } catch (err) {
        // The timeline line is a record, not a condition: the planned shutdown still goes ahead.
        ctx.log.error('Recording the shutdown on the timeline failed', err)
        return () => undefined
      }
    },
    changed: (state) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(CHANNELS.powerChanged, state)
      }
      if (state.countdownEndsAt === null) closeCountdown()
      if (state.plan && !timer) {
        timer = setInterval(() => {
          power.poll(Date.now()).catch((err: unknown) => ctx.log.error('The shutdown timer check failed', err))
        }, POLL_MS)
      }
      if (!state.plan && timer) {
        clearInterval(timer)
        timer = null
      }
      onState(state)
    },
    countdownStarted: (_state, plan) => {
      showCountdown()
      notify({ title: 'Perch 一分鐘後關機', body: `${countdownReason(plan, Date.now())}。按這裡可以取消。` }, showCountdown)
    },
    warn: (title, body) => {
      ctx.log.warn(`${title}: ${body}`)
      notify({ title, body }, () => ctx.showFloat())
    },
  })

  ipcMain.handle(CHANNELS.getPower, () => power.state())
  ipcMain.handle(CHANNELS.armShutdownTimer, (_e, when: unknown) => {
    const now = Date.now()
    return power.armTimer(timerAt(when, now, minuteMs), now)
  })
  ipcMain.handle(CHANNELS.armShutdownOnGpu, (_e, m: unknown) => power.armGpu(idleMinutes(m), Date.now()))
  ipcMain.handle(CHANNELS.cancelShutdown, () => power.cancel())
  ipcMain.handle(CHANNELS.shutdownNow, () => power.shutdownNow())
  ipcMain.handle(CHANNELS.readGpus, () => power.readGpus(Date.now()))

  return {
    power,
    minuteMs,
    stop() {
      if (timer) clearInterval(timer)
      timer = null
      closeCountdown()
    },
  }
}
