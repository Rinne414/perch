import { app, BrowserWindow, screen } from 'electron'
import { execFile } from 'node:child_process'

const SETTLE_MS = 1800
/** Time for the page to react to TC_SCREENSHOT_JS before the grab. */
const SCRIPT_SETTLE_MS = 700

/** Copies a physical-pixel rectangle of the real screen, so acrylic shows as it really looks. */
function grabScreen(rect: { x: number; y: number; width: number; height: number }, file: string): Promise<void> {
  const script = [
    "Add-Type -Namespace W -Name Dpi -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware();'",
    '[W.Dpi]::SetProcessDPIAware() | Out-Null',
    'Add-Type -AssemblyName System.Drawing',
    `$b = New-Object System.Drawing.Bitmap ${rect.width}, ${rect.height}`,
    '$g = [System.Drawing.Graphics]::FromImage($b)',
    `$g.CopyFromScreen(${rect.x}, ${rect.y}, 0, 0, $b.Size)`,
    `$b.Save('${file.replace(/'/g, "''")}')`,
  ].join('; ')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', script], (err) => (err ? reject(err) : resolve()))
  })
}

const BACKDROP_MARGIN = 60
const BACKDROP_SETTLE_MS = 900
/** The wallpaper from the design mockups, so public screenshots never show what is really behind the glass. */
const BACKDROP_HTML = `<body style="margin:0;height:100vh;background:
  radial-gradient(55% 45% at 18% 22%, #3f74e0 0%, transparent 70%),
  radial-gradient(50% 55% at 85% 30%, #9054d8 0%, transparent 70%),
  radial-gradient(65% 55% at 55% 95%, #1aa39c 0%, transparent 70%), #0d1531"></body>`

/** TC_SCREENSHOT_BACKDROP: puts a neutral wallpaper window right behind the captured one. */
async function showBackdrop(front: BrowserWindow): Promise<void> {
  const b = front.getBounds()
  const backdrop = new BrowserWindow({
    x: b.x - BACKDROP_MARGIN,
    y: b.y - BACKDROP_MARGIN,
    width: b.width + 2 * BACKDROP_MARGIN,
    height: b.height + 2 * BACKDROP_MARGIN,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
  })
  backdrop.setAlwaysOnTop(true, 'floating')
  await backdrop.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(BACKDROP_HTML)}`)
  backdrop.showInactive()
  await new Promise((resolve) => setTimeout(resolve, BACKDROP_SETTLE_MS))
}

/**
 * Development aid: with TC_SCREENSHOT=<file.png> set, print the window's text,
 * grab it from the screen once rendered, and quit. TC_SCREENSHOT_JS runs in the
 * page first (for example a click that opens a panel); if that focuses another
 * window (the float opening the main window), that window is captured instead.
 */
export function captureIfRequested(win: BrowserWindow): void {
  const target = process.env['TC_SCREENSHOT']
  if (!target || app.isPackaged) return
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      const script = process.env['TC_SCREENSHOT_JS']
      if (script) {
        await win.webContents.executeJavaScript(script)
        await new Promise((resolve) => setTimeout(resolve, SCRIPT_SETTLE_MS))
      }
      const shown = (script && BrowserWindow.getFocusedWindow()) || win
      const text = (await shown.webContents.executeJavaScript('document.body.innerText')) as string
      process.stdout.write(`[screenshot] rendered text: ${JSON.stringify(text)}\n`)
      if (process.env['TC_SCREENSHOT_BACKDROP']) await showBackdrop(shown)
      // The grab reads real screen pixels, so nothing else may sit on top.
      shown.setAlwaysOnTop(true, 'screen-saver')
      shown.moveTop()
      await grabScreen(screen.dipToScreenRect(shown, shown.getBounds()), target)
      app.quit()
    }, SETTLE_MS)
  })
}
