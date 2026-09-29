import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { hookPayloadToEvent, isHookAgent } from '../integrations/adapters'
import { writeInboxEvent } from '../integrations/inbox'
import { agentPresent, install, INSTALLABLE, isInstallable, isInstalled, uninstall } from '../integrations/install'

/*
 * Usage:
 *   node perch-hook.js hook <agent> --inbox <dir>     (called by an agent's hook, payload on stdin)
 *   node perch-hook.js install <agent> --inbox <dir>
 *   node perch-hook.js uninstall <agent>
 *   node perch-hook.js status
 *
 * The hook command must never slow down or break the agent: it always exits 0
 * and writes problems to <inbox>/hook-errors.log instead.
 */

const STDIN_TIMEOUT_MS = 3000

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    const done = (): void => resolve(data)
    const timer = setTimeout(done, STDIN_TIMEOUT_MS)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => {
      clearTimeout(timer)
      done()
    })
    process.stdin.on('error', done)
  })
}

/** With a file named "debug" in the inbox, raw payloads are kept in <inbox>/raw for checking field names. */
function keepRawIfDebugging(inbox: string, agent: string, raw: string): void {
  if (!existsSync(join(inbox, 'debug'))) return
  const dir = join(inbox, 'raw')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${Date.now()}-${agent}.json`), raw, 'utf8')
}

async function runHook(agent: string, inbox: string): Promise<void> {
  try {
    const raw = await readStdin()
    keepRawIfDebugging(inbox, agent, raw)
    if (!isHookAgent(agent)) throw new Error(`unknown agent "${agent}"`)
    const event = hookPayloadToEvent(agent, JSON.parse(raw) as unknown, Date.now())
    if (event) writeInboxEvent(inbox, event)
  } catch (err) {
    try {
      mkdirSync(inbox, { recursive: true })
      appendFileSync(join(inbox, 'hook-errors.log'), `${new Date().toISOString()} ${agent}: ${(err as Error).message}\n`)
    } catch {
      // Nothing left to report to; stay silent for the agent's sake.
    }
  }
}

function manage(command: string, agent: string | undefined, args: string[]): number {
  const home = homedir()
  if (command === 'status') {
    for (const a of INSTALLABLE) {
      const state = isInstalled(a, home) ? 'installed' : agentPresent(a, home) ? 'not installed' : 'agent not found'
      process.stdout.write(`${a.padEnd(12)} ${state}\n`)
    }
    return 0
  }
  if (!agent || !isInstallable(agent)) {
    process.stderr.write(`Choose one of: ${INSTALLABLE.join(', ')}\n`)
    return 1
  }
  if (command === 'install') {
    const inboxDir = option(args, '--inbox')
    if (!inboxDir) {
      process.stderr.write('install needs --inbox <dir>\n')
      return 1
    }
    process.stdout.write(`Updated ${install(agent, { cliPath: __filename, inboxDir, home })}\n`)
    return 0
  }
  const file = uninstall(agent, home)
  process.stdout.write(file ? `Updated ${file}\n` : 'Nothing to remove\n')
  return 0
}

async function main(): Promise<void> {
  const [command, agent, ...rest] = process.argv.slice(2)
  if (command === 'hook') {
    await runHook(agent ?? '', option(rest, '--inbox') ?? join(homedir(), '.perch', 'inbox'))
    process.exit(0)
  }
  if (command === 'install' || command === 'uninstall' || command === 'status') {
    process.exit(manage(command, agent, rest))
  }
  process.stderr.write('Usage: perch-hook <hook|install|uninstall|status> [agent] [--inbox <dir>]\n')
  process.exit(1)
}

void main()
