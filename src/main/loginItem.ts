import { app } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/*
 * Starting with the system. Windows and macOS have this built into Electron; Linux desktops
 * read ~/.config/autostart/*.desktop instead (the freedesktop autostart standard).
 */

const AUTOSTART = join(process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), 'autostart', 'io.github.rinne414.perch.desktop')

/** The AppImage is mounted at a new place every run; its file on disk is in $APPIMAGE. */
const linuxExec = (): string => process.env['APPIMAGE'] || process.execPath

/** Only an installed copy can start with the system; a development run cannot. */
export const canOpenAtLogin = (): boolean => app.isPackaged

export function isOpenAtLogin(): boolean {
  if (!app.isPackaged) return false
  return process.platform === 'linux' ? existsSync(AUTOSTART) : app.getLoginItemSettings().openAtLogin
}

export function setOpenAtLogin(on: boolean): void {
  if (!app.isPackaged) return
  if (process.platform !== 'linux') {
    app.setLoginItemSettings({ openAtLogin: on })
    return
  }
  if (!on) {
    rmSync(AUTOSTART, { force: true })
    return
  }
  mkdirSync(join(AUTOSTART, '..'), { recursive: true })
  const exec = `"${linuxExec().replace(/(["\\`$])/g, '\\$1')}"`
  writeFileSync(AUTOSTART, ['[Desktop Entry]', 'Type=Application', 'Name=Perch', `Exec=${exec}`, 'X-GNOME-Autostart-enabled=true', ''].join('\n'))
}
