import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'
import { iconPath } from './paths'

export interface TrayActions {
  showFloat: () => void
  openMain: () => void
  openCapture: () => void
  cancelShutdown: () => void
  quit: () => void
}

/** macOS menu bar icons are 18 points tall; Linux panels usually draw 22-24 px. */
const TRAY_SIZE: Partial<Record<NodeJS.Platform, number>> = { darwin: 18, linux: 24 }
const DEFAULT_TRAY_SIZE = 32

/** `shutdown` names a planned shutdown ("23:30", "等 GPU 閒下來"); it gets a cancel item at the top. */
function trayMenu(actions: TrayActions, shutdown: string | null): Menu {
  const cancel: MenuItemConstructorOptions[] = shutdown
    ? [{ label: `取消關機（${shutdown}）`, click: actions.cancelShutdown }, { type: 'separator' }]
    : []
  return Menu.buildFromTemplate([
    ...cancel,
    { label: '顯示浮窗', click: actions.showFloat },
    { label: '開啟控制台', click: actions.openMain },
    { label: '快速記錄', click: actions.openCapture },
    { type: 'separator' },
    { label: '結束', click: actions.quit },
  ])
}

export function createTray(actions: TrayActions): Tray {
  const size = TRAY_SIZE[process.platform] ?? DEFAULT_TRAY_SIZE
  const tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: size, height: size }))
  setTrayShutdown(tray, actions, null)
  tray.on('click', actions.showFloat)
  return tray
}

export function setTrayShutdown(tray: Tray, actions: TrayActions, shutdown: string | null): void {
  tray.setToolTip(shutdown ? `Perch · 關機：${shutdown}` : 'Perch')
  tray.setContextMenu(trayMenu(actions, shutdown))
}
