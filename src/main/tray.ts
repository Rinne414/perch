import { Menu, Tray, nativeImage } from 'electron'
import { iconPath } from './paths'

export interface TrayActions {
  showFloat: () => void
  openMain: () => void
  openCapture: () => void
  quit: () => void
}

const TRAY_SIZE = 32

export function createTray(actions: TrayActions): Tray {
  const tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: TRAY_SIZE, height: TRAY_SIZE }))
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
