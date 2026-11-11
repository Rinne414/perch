import { app, dialog, type BrowserWindow } from 'electron'

export interface FolderPick {
  readonly title: string
  readonly buttonLabel: string
  /** Development runs take the folder from this variable, so tests need no dialog. */
  readonly devEnv: string
}

/** A folder picker; `picked` is false when a development run took the folder from its variable. */
export async function pickFolder(win: BrowserWindow | null, pick: FolderPick): Promise<{ folder: string; picked: boolean } | null> {
  const devDir = app.isPackaged ? undefined : process.env[pick.devEnv]
  if (devDir) return { folder: devDir, picked: false }
  const options: Electron.OpenDialogOptions = {
    title: pick.title,
    defaultPath: app.getPath('documents'),
    buttonLabel: pick.buttonLabel,
    properties: ['openDirectory', 'createDirectory'],
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  const folder = result.canceled ? undefined : result.filePaths[0]
  return folder ? { folder, picked: true } : null
}
