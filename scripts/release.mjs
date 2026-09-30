// Builds the Windows installer and publishes it as a GitHub release, together with the
// latest.yml and blockmap that 設定 → 檢查更新 reads. Uses the gh CLI's login; no token in files.
// Run: pnpm run release [-- --notes-file notes.md]   (without a notes file GitHub writes them)
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = 'Rinne414/perch'

const read = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()
const fail = (message) => {
  console.error(`release: ${message}`)
  process.exit(1)
}

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const tag = `v${version}`

// The installer must be built from exactly what is on GitHub under that tag.
if (read('git', ['status', '--porcelain'])) fail('commit or stash your changes first')
read('git', ['fetch', 'origin', 'main', '--tags'])
const head = read('git', ['rev-parse', 'HEAD'])
if (read('git', ['rev-parse', 'origin/main']) !== head) fail('HEAD is not origin/main; push first')
if (read('git', ['tag', '--list', tag])) fail(`${tag} is already released; bump the version in package.json`)

// pnpm is a .cmd script on Windows, which only starts through a shell; the command is fixed text.
execFileSync('pnpm', ['run', 'dist'], { stdio: 'inherit', shell: true })

const files = [`Perch-Setup-${version}.exe`, `Perch-Setup-${version}.exe.blockmap`, 'latest.yml'].map((f) => join('dist', f))
for (const f of files) if (!existsSync(f)) fail(`${f} was not built`)
if (!readFileSync(join('dist', 'latest.yml'), 'utf8').includes(`version: ${version}\n`)) fail('dist/latest.yml is for another version')

const at = process.argv.indexOf('--notes-file')
const notes = at > 0 && process.argv[at + 1] ? ['--notes-file', process.argv[at + 1]] : ['--generate-notes']
execFileSync('gh', ['release', 'create', tag, ...files, '--repo', REPO, '--target', head, '--title', `Perch ${version}`, ...notes], {
  stdio: 'inherit',
})
console.log(`release: ${tag} published — https://github.com/${REPO}/releases/tag/${tag}`)
