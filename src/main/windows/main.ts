import { BrowserWindow } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import { CHANNELS, type MainTab } from '@shared/ipc'
import { getSetting, setSetting } from '../db/settings'
import { iconPath } from '../paths'
import { onScreen, watchBounds, type SavedBounds } from './bounds'
import { loadView, preloadPath } from './load'
import { glassWindowOptions } from './glass'

interface MainState {
  readonly bounds: SavedBounds
  readonly maximized: boolean
}

const KEY = 'mainWindow'
const DEFAULT_STATE: MainState = { bounds: { width: 1000, height: 680 }, maximized: false }

const readState = (db: DatabaseSync): MainState => getSetting(db, KEY, DEFAULT_STATE)

export function createMainWindow(db: DatabaseSync, tab: MainTab = 'today'): BrowserWindow {
  const state = readState(db)
  const win = new BrowserWindow({
    ...onScreen(state.bounds),
    minWidth: 720,
    minHeight: 460,
    frame: false,
    show: false,
    title: 'Perch',
    icon: iconPath(),
    ...glassWindowOptions(),
    hasShadow: true,
    webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true },
  })
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize()
    win.show()
  })
  watchBounds(win, (bounds) => setSetting(db, KEY, { ...readState(db), bounds }))
  const saveMaximized = (): void => setSetting(db, KEY, { ...readState(db), maximized: win.isMaximized() })
  win.on('maximize', saveMaximized)
  win.on('unmaximize', saveMaximized)
  void loadView(win, 'main', { tab })
  return win
}

/** Brings an existing main window forward, switching tabs when asked. */
export function focusMainWindow(win: BrowserWindow, tab?: MainTab): void {
  if (tab) win.webContents.send(CHANNELS.navigate, tab)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
