import { useCallback, useEffect, useState } from 'react'
import { agentName, STATUS_LABEL } from '@shared/agents'
import { monthDay, whenLabel } from '@shared/format'
import type { ProjectDetail } from '@shared/projects'
import type { Item } from '@shared/types'
import { FolderButton, ResumeButton } from '../components/AgentCard'
import { CheckIcon, TrashIcon, WindowIcon } from '../components/Icons'
import { useAction } from '../components/Toast'
import { useRemove } from '../components/useRemove'
import './panel.css'

/** undefined while loading; null when no agent worked in that folder (any more). */
function useProjectDetail(cwd: string): ProjectDetail | null | undefined {
  const [detail, setDetail] = useState<ProjectDetail | null | undefined>(undefined)
  const load = useCallback(() => {
    window.api
      .getProjectDetail(cwd)
      .then(setDetail)
      .catch(() => setDetail(null))
  }, [cwd])
  useEffect(() => {
    load()
    return window.api.onChanged(load)
  }, [load])
  return detail
}

function ProjectItem({ item }: { item: Item }): React.JSX.Element {
  const run = useAction()
  const remove = useRemove()
  return (
    <li className="step">
      <button className="box" aria-label={`完成：${item.title}`} onClick={() => run(() => window.api.complete(item.id))}>
        <CheckIcon size={9} />
      </button>
      <span className="s">{item.title}</span>
      <button className="act icon" aria-label={`刪除：${item.title}`} onClick={() => remove(item)}>
        <TrashIcon />
      </button>
    </li>
  )
}

interface Props {
  readonly cwd: string
  readonly at: number
  readonly dayStartHour: number
  readonly onClose: () => void
}

/** The right-hand panel of one project: what was done there lately, and what is still to do. */
export function ProjectPanel({ cwd, at, dayStartHour, onClose }: Props): React.JSX.Element | null {
  const detail = useProjectDetail(cwd)
  const run = useAction()
  const [text, setText] = useState('')
  if (detail === undefined) return <aside className="item-panel project-panel" aria-busy="true" />
  if (detail === null) return null

  const { project, sessions, items } = detail
  const add = (): void => {
    const line = text.trim()
    if (!line) return
    setText('')
    run(() => window.api.captureForProject(line, cwd))
  }

  return (
    <aside className="item-panel project-panel" aria-label={project.name}>
      <div className="detail-top">
        <h2 className="panel-title">{project.name}</h2>
        <FolderButton cwd={cwd} labelled />
        <button className="wc small" aria-label="關閉" title="關閉（Esc）" onClick={onClose}>
          <WindowIcon kind="close" />
        </button>
      </div>
      <p className="proj-path panel-path">{cwd}</p>

      <div className="grp">
        <p className="lbl">最近做的</p>
        <ul className="hist">
          {sessions.map((s) => (
            <li key={s.id}>
              <time>{whenLabel(s.updatedAt, at, dayStartHour)}</time>
              <div>
                <div className="hist-head" title={s.title ?? undefined}>
                  <b>{agentName(s.agent)}</b>
                  {s.title && `「${s.title}」`}
                  <em className={`st-${s.status}`}>{STATUS_LABEL[s.status]}</em>
                </div>
                {s.detail && <div className="sub">{s.detail}</div>}
              </div>
              <ResumeButton session={s} />
            </li>
          ))}
        </ul>
      </div>

      <div className="grp">
        <p className="lbl">待辦{items.length > 0 && ` · ${items.length}`}</p>
        {items.length > 0 && (
          <ul className="steps">
            {items.map((i) => (
              <ProjectItem key={i.id} item={i} />
            ))}
          </ul>
        )}
        <input
          className="field"
          value={text}
          placeholder="記一件這個專案的事，Enter 存"
          aria-label={`記到 ${project.name}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
        />
      </div>

      <div className="detail-foot">
        <span>
          {monthDay(project.firstAt)} 第一次出現 · 共 {project.sessionCount} 次
        </span>
        <button
          className="btn ghost"
          title={project.hidden ? '回到上面的清單' : '一次性的資料夾：收進最下面「不再列出」'}
          onClick={() => run(() => window.api.setProjectHidden(cwd, !project.hidden))}
        >
          {project.hidden ? '恢復列出' : '不再列出'}
        </button>
      </div>
    </aside>
  )
}
