/** The parts of a keydown event a shortcut is made of. */
export interface KeyPress {
  /** Physical key (KeyboardEvent.code), so the shortcut works the same with a Chinese input method on. */
  readonly code: string
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly metaKey: boolean
}

const KEY_CODE = /^(?:Key([A-Z])|Digit([0-9])|(F(?:[1-9]|1[0-9]|2[0-4]))|(Space))$/
const ACCELERATOR = /^(Control\+)?(Alt\+)?(Shift\+)?([A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space)$/

/** Codes of the modifier keys themselves: pressing one alone is not a shortcut yet. */
export const isModifierCode = (code: string): boolean => /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(code)

/**
 * A global shortcut takes the keys away from every other program, so it needs two of
 * Ctrl / Alt / Shift: a single one would steal things like Ctrl+C or Alt+F4.
 */
const enoughModifiers = (ctrl: boolean, alt: boolean, shift: boolean): boolean => Number(ctrl) + Number(alt) + Number(shift) >= 2

/** Electron accelerator ("Control+Alt+N") for a key press, or null when it cannot be the capture shortcut. */
export function acceleratorOf(k: KeyPress): string | null {
  const m = KEY_CODE.exec(k.code)
  if (!m || k.metaKey || !enoughModifiers(k.ctrlKey, k.altKey, k.shiftKey)) return null
  const key = m[1] ?? m[2] ?? m[3] ?? m[4]
  return [k.ctrlKey && 'Control', k.altKey && 'Alt', k.shiftKey && 'Shift', key].filter(Boolean).join('+')
}

/** Accepts exactly what acceleratorOf produces. */
export function isCaptureAccelerator(v: string): boolean {
  const m = ACCELERATOR.exec(v)
  return m !== null && enoughModifiers(!!m[1], !!m[2], !!m[3])
}

/** "Ctrl + Alt + N" */
export const shortcutLabel = (accelerator: string): string =>
  accelerator
    .split('+')
    .map((part) => (part === 'Control' ? 'Ctrl' : part))
    .join(' + ')
