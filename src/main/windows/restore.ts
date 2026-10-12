import { BrowserWindow, screen } from 'electron'
import { iconPath } from '../paths'
import { glassWindowOptions } from './glass'
import { loadView, preloadPath } from './load'

const WIDTH = 580
const HEIGHT = 700

/**
 * 接回 Agent session: its own window in the middle of the main screen, brought to the front
 * when opened (a notification, the jump list, the desktop shortcut), never kept on top.
 */
export function createRestoreWindow(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay()
  const height = Math.min(HEIGHT, workArea.height - 40)
  const win = new BrowserWindow({
    x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width: WIDTH,
    height,
    minWidth: 460,
    minHeight: 420,
    frame: false,
    show: false,
    maximizable: false,
    title: '接回 Agent session',
    icon: iconPath(),
    ...glassWindowOptions(),
    hasShadow: true,
    webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true },
  })
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  void loadView(win, 'restore')
  return win
}

/** Shows an open reopen window in front of everything else. */
export function focusRestoreWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  // Windows keeps a background app from stealing focus; a moment on top brings the window forward.
  win.setAlwaysOnTop(true)
  win.focus()
  win.setAlwaysOnTop(false)
}
