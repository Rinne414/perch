import { useState } from 'react'

/** How long "已複製" stays on the button. */
const COPIED_MS = 1500

/** The lines to paste into an agent's own rules file (CLAUDE.md, AGENTS.md). */
const instructions = (command: string): string =>
  [
    '## Perch',
    '需要我之後處理的事（等我決定、要我手動做、還沒做完的），在專案資料夾裡用這個指令記進 Perch：',
    command,
    '句子開頭可以寫日期，例如「明天」「週五下午3點」；沒寫日期就進隨手記。',
  ].join('\n')

/**
 * 讓 agent 記進 Perch: the `perch-hook add` command, ready to paste into an agent's rules file.
 * Perch never edits those files itself; the person decides where it goes.
 */
export function AddCommandSection({ command }: { command: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const text = instructions(command)
  return (
    <section className="set" aria-labelledby="set-add">
      <div className="set-head">
        <h2 id="set-add">讓 agent 記進 Perch</h2>
        <p className="sub">
          agent 跑這個指令，就能把「之後要你處理的事」記進隨手記，掛在它工作的專案下。把下面這段貼進 agent 的規則檔（Claude Code 的
          CLAUDE.md、Codex 的 AGENTS.md），它就知道怎麼用。Perch 不會自己去改這些檔案。
        </p>
      </div>
      <div className="card add-card">
        <pre className="snippet">{text}</pre>
        <div className="snippet-acts">
          <button
            className="btn"
            onClick={() => {
              window.api.copyText(text)
              setCopied(true)
              setTimeout(() => setCopied(false), COPIED_MS)
            }}
          >
            {copied ? '已複製' : '複製這段'}
          </button>
        </div>
      </div>
    </section>
  )
}
