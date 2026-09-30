export const REPO_URL = 'https://github.com/Rinne414/perch'

/**
 * A new-issue link with the facts a bug report needs already filled in.
 * Nothing is sent: the browser opens the form and the person decides what to post.
 */
export function issueUrl(version: string, windowsBuild: string, arch: string): string {
  const body = [
    '**發生了什麼？ What happened?**',
    '',
    '',
    '**怎麼重現？ Steps to reproduce**',
    '',
    '',
    '---',
    `Perch ${version} · Windows ${windowsBuild} · ${arch}`,
    '<!-- 記錄檔：設定 → 更新與回報 → 打開記錄資料夾（perch.log）。附上之前先看一下有沒有不想公開的內容。 -->',
    '<!-- Log file: Settings → open the log folder (perch.log). Check it for anything private before attaching it. -->',
  ].join('\n')
  return `${REPO_URL}/issues/new?body=${encodeURIComponent(body)}`
}
