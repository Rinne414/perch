import { BrowserWindow, screen } from 'electron'
import { iconPath } from '../paths'
import { loadView, preloadPath } from './load'
import { glassWindowOptions } from './glass'

const WIDTH = 380
const HEIGHT = 250
/** A countdown nobody can see is no warning; if the window is not up by then, `onFail` runs. */
const SHOW_DEADLINE_MS = 5_000

/**
 * The last minute before a shutdown: in the middle of the main screen, above everything
 * (full-screen apps included), in the taskbar so it can be found. Its first focus is
 * 取消關機, so a stray Enter cancels instead of shutting down. `onFail` runs at most once
 * when the page cannot load, its renderer dies, or it never shows.
 */
export function createOffWindow(onFail: (why: unknown) => void): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
    y: Math.round(workArea.y + (workArea.height - HEIGHT) / 2),
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Perch 要關機了',
    icon: iconPath(),
    ...glassWindowOptions(),
    hasShadow: true,
    webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true },
  })
  let failed = false
  const fail = (why: unknown): void => {
    if (failed || win.isDestroyed()) return
    failed = true
    onFail(why)
  }
  const deadline = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) fail(new Error('The countdown window did not show'))
  }, SHOW_DEADLINE_MS)
  win.on('closed', () => clearTimeout(deadline))
  win.webContents.on('render-process-gone', (_e, details) => fail(new Error(`Renderer gone: ${details.reason}`)))

  win.setMenuBarVisibility(false)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  loadView(win, 'off').catch(fail)
  return win
}
