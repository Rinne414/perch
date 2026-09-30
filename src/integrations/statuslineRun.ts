import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

/** A status line that takes longer than this is cut off; Claude Code would cancel it anyway. */
const WRAPPED_TIMEOUT_MS = 8000

/** Git for Windows puts git.exe in <root>\cmd; its bash is <root>\bin\bash.exe. */
function gitBash(): string | null {
  const fromEnv = process.env['CLAUDE_CODE_GIT_BASH_PATH']
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir || !existsSync(join(dir, 'git.exe'))) continue
    const bash = join(dirname(dir), 'bin', 'bash.exe')
    if (existsSync(bash)) return bash
  }
  return null
}

/**
 * The shell Claude Code itself would use for a status line: on Windows Git Bash when it is
 * installed, else PowerShell; elsewhere the POSIX shell.
 */
export function statuslineShell(command: string): { file: string; args: string[] } {
  if (process.platform !== 'win32') return { file: '/bin/sh', args: ['-c', command] }
  const bash = gitBash()
  return bash ? { file: bash, args: ['-c', command] } : { file: 'powershell.exe', args: ['-NoProfile', '-Command', command] }
}

/**
 * Runs the person's own status line with the same input Claude Code gave us and returns what it
 * printed, untouched (colours included). Anything that goes wrong yields an empty line.
 */
export function runWrapped(command: string, input: string): Promise<string> {
  return new Promise((resolve) => {
    const { file, args } = statuslineShell(command)
    const chunks: Buffer[] = []
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
    const timer = setTimeout(() => child.kill(), WRAPPED_TIMEOUT_MS)
    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.on('error', () => resolve(''))
    child.on('close', () => {
      clearTimeout(timer)
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(input)
  })
}
