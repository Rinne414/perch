import { describe, expect, test } from 'vitest'
import { SAVE_ERROR, saveFailureReason } from './saveErrors'

/** What Electron hands the renderer when a handler throws. */
const ipc = (message: string): string => `Error invoking remote method 'report:pdf': Error: ${message}`

describe('saveFailureReason', () => {
  test('says the real reason in plain words', () => {
    expect(saveFailureReason(ipc(`${SAVE_ERROR.printTimeout}: printing took longer than 45000 ms`))).toBe('印 PDF 太久沒有完成，已經停下來了')
    expect(saveFailureReason(ipc(`${SAVE_ERROR.printFailed}: the print page stopped (crashed)`))).toBe('印 PDF 的頁面沒有開起來或中途停掉了')
    expect(saveFailureReason(ipc(`${SAVE_ERROR.sessionGone}: claude-code:abc`))).toBe('這個 session 已經不在清單裡了')
    expect(saveFailureReason(ipc("ENOSPC: no space left on device, write"))).toBe('磁碟滿了')
  })

  test('file system refusals all mean the folder cannot be written', () => {
    for (const code of ['EACCES', 'EPERM', 'EROFS', 'EBUSY', 'ENOENT', 'ENAMETOOLONG']) {
      expect(saveFailureReason(ipc(`${code}: something, open 'D:\\vault\\Perch\\報告\\x.md'`))).toContain('資料夾不能寫入')
    }
  })

  test('anything else is called unknown, never blamed on the folder', () => {
    expect(saveFailureReason(ipc('Something odd'))).toBe('原因不明，再試一次看看')
  })
})
