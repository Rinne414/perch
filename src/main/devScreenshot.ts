import { app, BrowserWindow, screen } from 'electron'
import { execFile } from 'node:child_process'

const SETTLE_MS = 1800
/** Time for the page to react to TC_SCREENSHOT_JS before the grab. */
const SCRIPT_SETTLE_MS = 700
/** Time for a pasted picture or text to be saved and shown. */
const PASTE_SETTLE_MS = 2500

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

const RAISE_SETTLE_MS = 300
const BACKDROP_MARGIN = 60
const BACKDROP_SETTLE_MS = 900
/**
 * Known backgrounds, so screenshots never show what is really behind the glass:
 * the mockups' wallpaper, and a plain light page like a browser or document window.
 */
const BACKDROPS: Readonly<Record<string, string>> = {
  wallpaper: `radial-gradient(55% 45% at 18% 22%, #3f74e0 0%, transparent 70%),
    radial-gradient(50% 55% at 85% 30%, #9054d8 0%, transparent 70%),
    radial-gradient(65% 55% at 55% 95%, #1aa39c 0%, transparent 70%), #0d1531`,
  light: `linear-gradient(#f3f3f3 0 44px, #ffffff 44px)`,
}

/** TC_SCREENSHOT_BACKDROP=wallpaper|light: puts a known background window right behind the captured one. */
async function showBackdrop(front: BrowserWindow): Promise<void> {
  const background = BACKDROPS[process.env['TC_SCREENSHOT_BACKDROP'] ?? ''] ?? BACKDROPS['wallpaper']
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
  const html = `<body style="margin:0;height:100vh;background:${background}"></body>`
  await backdrop.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
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
      // TC_SCREENSHOT_PASTE=1: run the real paste command (what Ctrl+V does) with the system clipboard.
      if (process.env['TC_SCREENSHOT_PASTE']) {
        win.webContents.paste()
        await new Promise((resolve) => setTimeout(resolve, PASTE_SETTLE_MS))
      }
      const shown = (script && BrowserWindow.getFocusedWindow()) || win
      const text = (await shown.webContents.executeJavaScript('document.body.innerText')) as string
      process.stdout.write(`[screenshot] rendered text: ${JSON.stringify(text)}\n`)
      if (process.env['TC_SCREENSHOT_BACKDROP']) await showBackdrop(shown)
      // The grab reads real screen pixels, so nothing else may sit on top.
      shown.setAlwaysOnTop(true, 'screen-saver')
      shown.moveTop()
      // Give the window manager a moment to apply the new order before reading pixels.
      await new Promise((resolve) => setTimeout(resolve, RAISE_SETTLE_MS))
      await grabScreen(screen.dipToScreenRect(shown, shown.getBounds()), target)
      app.quit()
    }, SETTLE_MS)
  })
}
