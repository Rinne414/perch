import { BrowserWindow, screen } from 'electron'
import { loadView, preloadPath } from './load'

const WIDTH = 560
const HEIGHT = 132
/** Distance from the top of the screen, like a launcher. */
const TOP_RATIO = 0.22

export function createCaptureWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    show: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundMaterial: 'acrylic',
    backgroundColor: '#00000000',
    webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true },
  })
  win.setMenuBarVisibility(false)
  win.on('blur', () => win.hide())
  void loadView(win, 'capture')
  return win
}

/** Opens the capture box on the screen the mouse is on, or hides it if it is open. */
export function toggleCapture(win: BrowserWindow): void {
  if (win.isVisible()) {
    win.hide()
    return
  }
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  win.setBounds({
    x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height * TOP_RATIO),
    width: WIDTH,
    height: HEIGHT,
  })
  win.show()
  win.focus()
}
