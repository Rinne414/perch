/**
 * Why saving a note or a PDF failed, carried across IPC as a code at the start of the error's
 * message (an IPC error keeps only its message), and said in plain words in the toast.
 */
export const SAVE_ERROR = {
  printTimeout: 'PERCH_PRINT_TIMEOUT',
  printFailed: 'PERCH_PRINT_FAILED',
  sessionGone: 'PERCH_SESSION_GONE',
} as const

/** File system error codes that mean the folder or file cannot be written. */
const CANNOT_WRITE = /\b(EACCES|EPERM|EROFS|EBUSY|ENOENT|ENOTDIR|EISDIR|ENAMETOOLONG|EINVAL|EEXIST|EMFILE)\b/

/** The reason after "沒有存成 …：", from an error message that came back over IPC. */
export function saveFailureReason(message: string): string {
  if (message.includes(SAVE_ERROR.printTimeout)) return '印 PDF 太久沒有完成，已經停下來了'
  if (message.includes(SAVE_ERROR.printFailed)) return '印 PDF 的頁面沒有開起來或中途停掉了'
  if (message.includes(SAVE_ERROR.sessionGone)) return '這個 session 已經不在清單裡了'
  if (/\bENOSPC\b/.test(message)) return '磁碟滿了'
  if (CANNOT_WRITE.test(message)) return '資料夾不能寫入（可能是唯讀、被別的程式占用、已經不在，或路徑太長）'
  return '原因不明，再試一次看看'
}
