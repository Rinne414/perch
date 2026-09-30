import { Menu, Tray, nativeImage } from 'electron'
import { iconPath } from './paths'

export interface TrayActions {
  showFloat: () => void
  openMain: () => void
  openCapture: () => void
  quit: () => void
}

/** macOS menu bar icons are 18 points tall; Linux panels usually draw 22-24 px. */
const TRAY_SIZE: Partial<Record<NodeJS.Platform, number>> = { darwin: 18, linux: 24 }
const DEFAULT_TRAY_SIZE = 32

export function createTray(actions: TrayActions): Tray {
  const size = TRAY_SIZE[process.platform] ?? DEFAULT_TRAY_SIZE
  const tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: size, height: size }))
  tray.setToolTip('Perch')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '顯示浮窗', click: actions.showFloat },
      { label: '開啟主視窗', click: actions.openMain },
      { label: '快速記錄', click: actions.openCapture },
      { type: 'separator' },
      { label: '結束', click: actions.quit },
    ]),
  )
  tray.on('click', actions.showFloat)
  return tray
}
