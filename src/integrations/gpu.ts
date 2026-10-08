import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseNvidiaSmi, type GpuReading } from '@shared/power'

/** nvidia-smi normally answers in well under a second; a driver in trouble must not hold a poll forever. */
const TIMEOUT_MS = 5_000
/** execFile's timeout kills the process, but a process stuck in the driver may never report back. */
const GIVE_UP_MS = 8_000
const QUERY = ['--query-gpu=name,utilization.gpu', '--format=csv,noheader,nounits']

/**
 * Where the NVIDIA driver puts nvidia-smi on Windows (System32 today, NVSMI on old drivers),
 * by full path so no other folder's nvidia-smi.exe is run; elsewhere the one on PATH.
 */
function nvidiaSmi(): string {
  if (process.platform !== 'win32') return 'nvidia-smi'
  const candidates = [
    join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
  ]
  return candidates.find((file) => existsSync(file)) ?? candidates[0]
}

function runNvidiaSmi(): Promise<GpuReading[] | null> {
  return new Promise((resolve) => {
    const giveUp = setTimeout(() => resolve(null), GIVE_UP_MS)
    execFile(nvidiaSmi(), QUERY, { timeout: TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      clearTimeout(giveUp)
      resolve(err ? null : parseNvidiaSmi(String(stdout)))
    })
  })
}

/**
 * Asks nvidia-smi (read-only; it ships with the NVIDIA driver) how busy each GPU is. No shell,
 * fixed arguments. Any failure, a missing driver included, is null — and null is never idle.
 * `fakeFile` (development tests only) is read instead and holds nvidia-smi's output.
 */
export function readNvidiaGpus(fakeFile?: string): Promise<GpuReading[] | null> {
  if (!fakeFile) return runNvidiaSmi()
  return readFile(fakeFile, 'utf8')
    .then(parseNvidiaSmi)
    .catch(() => null)
}
