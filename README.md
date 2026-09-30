# Perch

A local-first Windows desktop reminder for people who run AI coding agents.

A small glass window perches on your desktop and shows only what needs you **now**: today's fixed schedule, agents that finished or are waiting for your answer, today's work with its next step, and routines you have not done for a while. A main window keeps the rest — what you jotted down, every agent session, routines and their history, and a calendar of what happened and what is coming.

> Early version (0.1), Windows only. The interface is in Traditional Chinese.

![The float](docs/screenshots/float.png)

![Main window: today with a task opened](docs/screenshots/main-today.png)

## What it does

- **Agents come back to you.** Hooks for Claude Code, Codex, Grok Build and OpenCode report when a session finishes, fails or waits for input. You get a notification, and the session stays in the float until you mark it seen. The **Agent** tab keeps every session of the week — what it was asked, what came back — and a **回去** button copies the command that reopens it in its folder.
- **Capture without friction.** `Ctrl+Alt+N` anywhere opens a one-line box (設定 → 快速記錄 changes the keys). Dates are read from what you type, in Chinese or English: `明天下午3點 交報告`, `週五`, `10/2 17:00`. Lines without a date wait in **隨手記** until you give them a day.
- **Fixed schedules.** Work shifts or classes at fixed weekly times ("週三 16:00–19:00, 週四 18:30–21:30"), each day with its own hours. They show on today's list with a countdown and remind you 30 minutes before (adjustable).
- **A real calendar.** The month at a glance, like the Windows tray calendar. Pick a day to see what happened (a timeline and a summary), fill in what you forgot, or plan something for a day ahead.
- **Start instead of finish.** Break a task into small steps; the float shows the next one. **先做 5 分鐘** starts a five-minute timer on it — no pop-up when it ends, no failure state.
- **Honest but gentle.** Overdue work is shown as it is, with calm ways out: move it, take the date away, or **不做了** (let it go without deleting it).
- **"When did I last…?"** Routines either have a goal ("every 3 days", the float reminds you) or only remember the last time (never nags). Each one keeps its history; you can record a time after the fact ("昨天", "前天晚上").
- **Glass that stays readable.** A navy-tinted glass that works over bright windows as well as dark wallpapers; 設定 → 玻璃濃淡 picks how strong it is.
- **Your data stays yours.** A copy of the database is kept every day and before an update changes it. 設定 → 匯出 writes everything as JSON (complete) and Markdown (readable).
- **Updates when you ask.** 設定 → 檢查更新 looks for a newer release on GitHub and downloads it; 重開更新 installs it, or it installs the next time Perch quits.
- **Nothing leaves your computer.** No account, no server, no network port. The only time Perch goes online is when you press 檢查更新.

![The calendar with a past day opened](docs/screenshots/calendar.png)

![Routines with their history](docs/screenshots/routines.png)

## Install

Download `Perch-Setup-<version>.exe` from [Releases](https://github.com/Rinne414/perch/releases) and run it, or build it yourself (see below). The installer is not code-signed yet, so Windows warns about an unknown publisher: choose **More info → Run anyway**.

Later versions come through 設定 → 檢查更新. Until the installer is signed, a downloaded update is checked against the SHA-512 checksum published with the release.

The app starts with Windows if you turn on 設定 → 開機時啟動.

### Connect your agents

Open the main window (tray menu → 開啟主視窗) → **設定**, then press **安裝** next to each agent.

- This edits the agent's own config (`~/.claude/settings.json`, `~/.codex/hooks.json`, …) and keeps a backup next to it as `*.perch.bak`. **移除** takes our entries out again and leaves everything else as it was.
- The hooks run `node`, so [Node.js](https://nodejs.org) 20 or newer must be on your `PATH` (OpenCode uses a plugin and does not need it).
- **Codex** only runs hooks you trust: after installing, run `/hooks` inside Codex once and trust `perch`.
- Gemini CLI can be installed but has not been verified yet.

### Other agents

Anything can report to Perch by writing a JSON file into the inbox folder (`%APPDATA%\Perch\inbox`). The format is public and versioned — see [`src/shared/agentEvent.ts`](src/shared/agentEvent.ts):

```json
{ "v": 1, "agent": "my-agent", "sessionId": "abc123", "status": "done", "cwd": "C:\\code\\app", "title": "fix the login page" }
```

`status` is one of `running`, `needs_input`, `done`, `failed`, `cancelled`. Write to a temporary name first and rename it to `*.json`, so the app never reads half a file.

## Your data

Everything lives in `%APPDATA%\Perch`: a SQLite database (`tasks.db`), the agent inbox, `backups` and `logs`. From an agent report Perch keeps the status, the project folder, the first line of your prompt as a title, and one line of detail (the agent's last reply, what it is waiting for, or the error). 設定 → 按來源清除資料 deletes everything one agent wrote.

- **Backups.** `backups\tasks-<date>_<time>.db` once a day (the last 7 are kept), and `…-before-update.db` right before a new version changes the database (the last 3). To go back to one, quit Perch from the tray, delete `tasks.db`, `tasks.db-wal` and `tasks.db-shm`, and copy the backup in as `tasks.db`.
- **Log.** `logs\perch.log` records errors and app events (start, update, backup), never task titles or prompts. 設定 → 回報問題 opens a GitHub issue with the version filled in; read the log before attaching it.
- **Export.** The JSON holds every item, the whole timeline and the agent sessions (times in Unix milliseconds, `"format": 1`); the Markdown is the same for reading.

## Build from source

Requires Node.js 20+ and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm test            # unit tests
pnpm run typecheck
pnpm run build       # then: node_modules/electron/dist/electron.exe .
pnpm run dist        # Windows installer in dist/
pnpm run release     # maintainers: build and publish a GitHub release (gh login, clean and pushed main, a new version)
```

If `node_modules/electron/dist/electron.exe` is missing after install, run `node node_modules/electron/install.js`.

Development switches (ignored by an installed copy):

| Variable | Effect |
|---|---|
| `TC_DATA_DIR=<folder>` | Use a throwaway data folder instead of `.data/` |
| `TC_AGENT_HOME=<folder>` | Hook install / remove edits a fake home folder, never your real agent configs |
| `TC_SEED=1` | Fill an empty database with sample data |
| `TC_SCREENSHOT=<file.png>` | Grab the window from the screen once rendered, print its text, and quit |
| `TC_SCREENSHOT_VIEW=float\|main\|capture`, `TC_SCREENSHOT_TAB=inbox` | Which window and tab to capture |
| `TC_SCREENSHOT_JS=<script>` | Run a script in the page first (clicks, typing) |
| `TC_SCREENSHOT_BACKDROP=wallpaper\|light` | Put a known background (the mockups' wallpaper, or a plain light page) behind the glass |
| `TC_UPDATE_FEED=<url>` | 檢查更新 reads `latest.yml` from this address instead of GitHub; a development run downloads but never installs |
| `TC_EXPORT_DIR=<folder>` | 匯出 writes here without asking for a folder |

Why it works the way it does — what was borrowed from Todoist, TickTick, Sunsama, Amazing Marvin, Goblin Tools, Last Time, Super Productivity, Hindsight and Claude Code's Agent View, and what was left out on purpose — is in [`docs/reference-apps.md`](docs/reference-apps.md).

## 中文說明

Perch 是給同時跑好幾個 AI agent 的人用的桌面提醒工具，所有資料都只存在自己的電腦裡。

- 浮窗只顯示「現在」要處理的事：今天的固定行程、跑完或在等你回覆的 agent、今天的事和下一步、太久沒做的例行事項。
- 在任何地方按 `Ctrl+Alt+N` 就能記下一件事，日期可以直接用中文寫：「明天下午3點 交報告」；沒寫日期的會先放進「隨手記」。
- 固定行程（例如每週三 16:00–19:00、週四 18:30–21:30 上班）會出現在今天的行程，開始前 30 分鐘提醒。
- 日曆像 Windows 右下角那樣一格一天：點過去的日子看那天做了什麼和總結，也能補記；點未來的日子看行程、截止，或直接加一件事。
- Agent 分頁列出這週所有 session：問了什麼、回了什麼，一鍵複製回去的指令。
- 不會催你、不算連續天數；做不到的事可以「不做了」，紀錄還會留著。
- 每天自動備份一份資料庫，更新前也會先備份；設定 → 匯出 可以存成 JSON 和 Markdown。
- 設定 → 檢查更新：只有按下去才會連到 GitHub，找到新版就下載，按「重開更新」就裝好。

安裝方式、連接 agent 的步驟和資料位置請看上面的英文說明。

## License

[GPL-3.0-or-later](LICENSE). You may use, study, change and share it; changed versions you distribute must stay open under the same license.
