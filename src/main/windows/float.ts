import { BrowserWindow } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import { getSetting, setSetting } from '../db/settings'
import { onScreen, watchBounds, type SavedBounds } from './bounds'
import { loadView, preloadPath } from './load'

interface FloatState {
  readonly bounds: SavedBounds
  readonly pinned: boolean
}

const KEY = 'floatWindow'
const DEFAULT_STATE: FloatState = { bounds: { width: 360, height: 580 }, pinned: true }

export function readFloatState(db: DatabaseSync): FloatState {
  return getSetting(db, KEY, DEFAULT_STATE)
}

export function saveFloatPinned(db: DatabaseSync, pinned: boolean): void {
  setSetting(db, KEY, { ...readFloatState(db), pinned })
}

export function createFloatWindow(db: DatabaseSync): BrowserWindow {
  const state = readFloatState(db)
  const win = new BrowserWindow({
    ...onScreen(state.bounds),
    minWidth: 300,
    minHeight: 280,
    frame: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: state.pinned,
    backgroundMaterial: 'acrylic',
    backgroundColor: '#00000000',
    hasShadow: true,
    webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true },
  })
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => win.show())
  watchBounds(win, (bounds) => setSetting(db, KEY, { ...readFloatState(db), bounds }))
  void loadView(win, 'float')
  return win
}
