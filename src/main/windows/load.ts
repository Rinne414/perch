import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'

export type View = 'float' | 'capture' | 'main' | 'off'

/** Every window loads the same renderer bundle and picks its screen from `?view=`. */
export function loadView(win: BrowserWindow, view: View, extra: Record<string, string> = {}): Promise<void> {
  const query = { view, ...extra }
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) return win.loadURL(`${devUrl}?${new URLSearchParams(query)}`)
  return win.loadFile(join(__dirname, '../renderer/index.html'), { query })
}

export const preloadPath = (): string => join(__dirname, '../preload/index.js')
