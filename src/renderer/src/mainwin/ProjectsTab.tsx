import { useState } from 'react'
import { agentName, STATUS_LABEL } from '@shared/agents'
import type { MainPayload } from '@shared/ipc'
import { groupProjects, isResting, OLD_DAYS, projectAgeLabel, RESTING_DAYS, type ProjectSummary } from '@shared/projects'
import { FolderButton, ResumeButton } from '../components/AgentCard'
import { ChevronIcon } from '../components/Icons'
import './projects.css'

interface Props {
  readonly payload: MainPayload
  readonly at: number
  readonly selected: string | null
  readonly onOpen: (cwd: string) => void
}

interface RowProps {
  readonly project: ProjectSummary
  readonly at: number
  readonly dayStartHour: number
  readonly selected: boolean
  readonly onOpen: (cwd: string) => void
}

/** One folder: when it was last touched, what was asked last and how that went. */
function ProjectRow({ project, at, dayStartHour, selected, onOpen }: RowProps): React.JSX.Element {
  const { latest } = project
  return (
    <li className={`row proj agent-${latest.status}${selected ? ' selected' : ''}`}>
      <span className="dot" aria-hidden="true" />
      <button className="main open" aria-pressed={selected} onClick={() => onOpen(project.cwd)}>
        <span className="proj-name">
          <span className="proj-title">{project.name}</span>
          <span className="proj-path">{project.cwd}</span>
        </span>
        <span className="sub last" title={latest.title ?? undefined}>
          <b>{agentName(latest.agent)}</b>
          {latest.title && `「${latest.title}」`} · <em>{STATUS_LABEL[latest.status]}</em>
        </span>
        {project.openItems > 0 && <span className="sub faint">{project.openItems} 件待辦</span>}
      </button>
      <div className="end">
        <span className="agent-acts">
          <ResumeButton session={latest} />
          <FolderButton cwd={project.cwd} />
        </span>
        <span className={`age${isResting(project, at, dayStartHour) ? ' stale' : ''}`}>
          {projectAgeLabel(project, at, dayStartHour)}
        </span>
      </div>
    </li>
  )
}

/** A folded group: long untouched folders, or the ones the person asked not to see. */
function Folded({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <section className="sec folded">
      <button className="more" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronIcon open={open} />
        {label}
      </button>
      {open && <ul>{children}</ul>}
    </section>
  )
}

/** Every folder agents worked in, from the agent reports alone: where each one was left off. */
export function ProjectsTab({ payload, at, selected, onOpen }: Props): React.JSX.Element {
  const { dayStartHour } = payload
  const groups = groupProjects(payload.projects, at, dayStartHour)
  const row = (p: ProjectSummary): React.JSX.Element => (
    <ProjectRow key={p.cwd} project={p} at={at} dayStartHour={dayStartHour} selected={selected === p.cwd} onOpen={onOpen} />
  )
  return (
    <div className="projects-tab">
      <header className="ph">
        <h1>專案</h1>
        <p>從 agent 紀錄自動整理，最近碰過的在上面</p>
      </header>
      {groups.recent.length > 0 && (
        <section className="sec" aria-labelledby="pj-recent">
          <h2 id="pj-recent">這幾天</h2>
          <ul>{groups.recent.map(row)}</ul>
        </section>
      )}
      {groups.resting.length > 0 && (
        <section className="sec" aria-labelledby="pj-resting">
          <h2 id="pj-resting">
            放了一陣子<small>{RESTING_DAYS} 天以上沒碰</small>
          </h2>
          <ul>{groups.resting.map(row)}</ul>
        </section>
      )}
      {groups.old.length > 0 && <Folded label={`超過 ${OLD_DAYS} 天沒碰的 ${groups.old.length} 個`}>{groups.old.map(row)}</Folded>}
      {groups.hidden.length > 0 && <Folded label={`不再列出的 ${groups.hidden.length} 個`}>{groups.hidden.map(row)}</Folded>}
      {payload.projects.length === 0 && (
        <div className="mw-empty">
          <p>還沒有 agent 回報過在哪個資料夾工作。</p>
          <p className="faint">agent 跑過一次之後，它的資料夾就會出現在這裡。</p>
        </div>
      )}
    </div>
  )
}
