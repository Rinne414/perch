import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type Api, type MainTab, type UpdateStatus } from '@shared/ipc'

/** The Api interface types each call; the bridge only forwards arguments. */
const invoke =
  (channel: string) =>
  (...args: unknown[]): Promise<never> =>
    ipcRenderer.invoke(channel, ...args) as Promise<never>

const api: Api = {
  getNow: invoke(CHANNELS.getNow),
  getMain: invoke(CHANNELS.getMain),
  capture: invoke(CHANNELS.capture),
  complete: invoke(CHANNELS.complete),
  reopen: invoke(CHANNELS.reopen),
  postpone: invoke(CHANNELS.postpone),
  plan: invoke(CHANNELS.plan),
  setDue: invoke(CHANNELS.setDue),
  rename: invoke(CHANNELS.rename),
  remove: invoke(CHANNELS.remove),
  drop: invoke(CHANNELS.drop),
  rescheduleOverdue: invoke(CHANNELS.rescheduleOverdue),
  undoBatch: invoke(CHANNELS.undoBatch),
  undoRemove: invoke(CHANNELS.undoRemove),
  addStep: invoke(CHANNELS.addStep),
  createRoutine: invoke(CHANNELS.createRoutine),
  updateRoutine: invoke(CHANNELS.updateRoutine),
  getRoutineHistory: invoke(CHANNELS.getRoutineHistory),
  recordRoutine: invoke(CHANNELS.recordRoutine),
  removeRoutineRecord: invoke(CHANNELS.removeRoutineRecord),
  startFocus: invoke(CHANNELS.startFocus),
  extendFocus: invoke(CHANNELS.extendFocus),
  stopFocus: invoke(CHANNELS.stopFocus),
  getMonth: invoke(CHANNELS.getMonth),
  getDay: invoke(CHANNELS.getDay),
  captureOn: invoke(CHANNELS.captureOn),
  addManualEntry: invoke(CHANNELS.addManualEntry),
  removeManualEntry: invoke(CHANNELS.removeManualEntry),
  setDayNote: invoke(CHANNELS.setDayNote),
  acknowledgeAgents: invoke(CHANNELS.acknowledgeAgents),
  dismissRecap: invoke(CHANNELS.dismissRecap),
  getIntegrations: invoke(CHANNELS.getIntegrations),
  setHook: invoke(CHANNELS.setHook),
  clearAgentData: invoke(CHANNELS.clearAgentData),
  setStatusline: invoke(CHANNELS.setStatusline),
  getAppInfo: invoke(CHANNELS.getAppInfo),
  setOpenAtLogin: invoke(CHANNELS.setOpenAtLogin),
  setGlass: invoke(CHANNELS.setGlass),
  setCaptureShortcut: invoke(CHANNELS.setCaptureShortcut),
  openFolder: (folder) => ipcRenderer.send(CHANNELS.openFolder, folder),
  exportData: invoke(CHANNELS.exportData),
  pickObsidianFolder: invoke(CHANNELS.pickObsidianFolder),
  clearObsidianFolder: invoke(CHANNELS.clearObsidianFolder),
  reportProblem: () => ipcRenderer.send(CHANNELS.reportProblem),
  getUpdateStatus: invoke(CHANNELS.getUpdateStatus),
  checkForUpdate: invoke(CHANNELS.checkForUpdate),
  installUpdate: () => ipcRenderer.send(CHANNELS.installUpdate),
  copyText: (text) => ipcRenderer.send(CHANNELS.copyText, text),
  setPinned: invoke(CHANNELS.setPinned),
  openMain: (tab) => ipcRenderer.send(CHANNELS.openMain, tab),
  windowAction: (action) => ipcRenderer.send(CHANNELS.windowAction, action),
  hideWindow: () => ipcRenderer.send(CHANNELS.hideWindow),
  onChanged: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on(CHANNELS.changed, handler)
    return () => ipcRenderer.removeListener(CHANNELS.changed, handler)
  },
  onUpdateStatus: (listener) => {
    const handler = (_e: unknown, status: UpdateStatus): void => listener(status)
    ipcRenderer.on(CHANNELS.updateStatus, handler)
    return () => ipcRenderer.removeListener(CHANNELS.updateStatus, handler)
  },
  onNavigate: (listener) => {
    const handler = (_e: unknown, tab: MainTab): void => listener(tab)
    ipcRenderer.on(CHANNELS.navigate, handler)
    return () => ipcRenderer.removeListener(CHANNELS.navigate, handler)
  },
}

contextBridge.exposeInMainWorld('api', api)
