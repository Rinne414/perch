interface IconProps {
  readonly size?: number
}

export function PinIcon({ size = 14 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M6 2h4l-.5 4 2.5 2.5H4L6.5 6 6 2zM8 8.5V14" strokeLinejoin="round" />
    </svg>
  )
}

export function MinusIcon({ size = 12 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M2 6h8" />
    </svg>
  )
}

export function CheckIcon({ size = 10 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M2.5 6.2 5 8.6l4.5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function NavIcon({ size = 16, children }: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const TodayIcon = (p: IconProps): React.JSX.Element => (
  <NavIcon {...p}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" />
  </NavIcon>
)

export const InboxIcon = (p: IconProps): React.JSX.Element => (
  <NavIcon {...p}>
    <path d="M2 9.5 4 3.5h8l2 6V13H2z" />
    <path d="M2 9.5h3.5l1 1.5h3l1-1.5H14" />
  </NavIcon>
)

export const RoutineIcon = (p: IconProps): React.JSX.Element => (
  <NavIcon {...p}>
    <path d="M13 6.5A5 5 0 0 0 3.6 5M3 9.5A5 5 0 0 0 12.4 11" />
    <path d="M3.5 2.5V5H6M12.5 13.5V11H10" />
  </NavIcon>
)

export const TimelineIcon = (p: IconProps): React.JSX.Element => (
  <NavIcon {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.8V8l2.2 1.4" />
  </NavIcon>
)

export const CalendarIcon = (p: IconProps): React.JSX.Element => (
  <NavIcon {...p}>
    <rect x="2" y="3" width="12" height="11" rx="2" />
    <path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4" />
  </NavIcon>
)

export const SettingsIcon = (p: IconProps): React.JSX.Element => (
  <NavIcon {...p}>
    <path d="M2 4.5h7.5M12.5 4.5H14M2 11.5h1.5M6.5 11.5H14" />
    <circle cx="11" cy="4.5" r="1.5" />
    <circle cx="5" cy="11.5" r="1.5" />
  </NavIcon>
)

export const TrashIcon = ({ size = 12 }: IconProps): React.JSX.Element => (
  <NavIcon size={size}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </NavIcon>
)

export const PlusIcon = ({ size = 12 }: IconProps): React.JSX.Element => (
  <NavIcon size={size}>
    <path d="M8 3v10M3 8h10" />
  </NavIcon>
)

export const ChevronIcon = ({ size = 12, open = false }: IconProps & { open?: boolean }): React.JSX.Element => (
  <NavIcon size={size}>
    <path d={open ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4'} />
  </NavIcon>
)

export function WindowIcon({ kind }: { kind: 'minimize' | 'maximize' | 'close' }): React.JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      {kind === 'minimize' && <path d="M0 5h10" />}
      {kind === 'maximize' && <rect x="0.5" y="0.5" width="9" height="9" />}
      {kind === 'close' && <path d="M0 0l10 10M10 0 0 10" />}
    </svg>
  )
}

export const PlayIcon = ({ size = 9 }: IconProps): React.JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
    <path d="M2 1.2v7.6L8.6 5z" />
  </svg>
)
