import { describe, expect, test } from 'vitest'
import { acceleratorOf, isCaptureAccelerator, isModifierCode, shortcutLabel, type KeyPress } from './shortcut'

const press = (code: string, mods: Partial<Omit<KeyPress, 'code'>> = {}): KeyPress => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
})

describe('capture shortcut', () => {
  test('reads letters, digits, F-keys and Space by their physical key', () => {
    expect(acceleratorOf(press('KeyN', { ctrlKey: true, altKey: true }))).toBe('Control+Alt+N')
    expect(acceleratorOf(press('Digit5', { ctrlKey: true, shiftKey: true }))).toBe('Control+Shift+5')
    expect(acceleratorOf(press('F12', { altKey: true, shiftKey: true }))).toBe('Alt+Shift+F12')
    expect(acceleratorOf(press('Space', { ctrlKey: true, altKey: true, shiftKey: true }))).toBe('Control+Alt+Shift+Space')
  })

  test('needs two of Ctrl, Alt and Shift so it cannot steal Ctrl+C or Alt+F4', () => {
    expect(acceleratorOf(press('KeyC', { ctrlKey: true }))).toBeNull()
    expect(acceleratorOf(press('F4', { altKey: true }))).toBeNull()
    expect(acceleratorOf(press('KeyN'))).toBeNull()
  })

  test('leaves out the Windows key and keys that are not letters, digits, F-keys or Space', () => {
    expect(acceleratorOf(press('KeyN', { ctrlKey: true, altKey: true, metaKey: true }))).toBeNull()
    expect(acceleratorOf(press('Enter', { ctrlKey: true, altKey: true }))).toBeNull()
    expect(acceleratorOf(press('F25', { ctrlKey: true, altKey: true }))).toBeNull()
  })

  test('the main process accepts exactly what a key press produces', () => {
    expect(isCaptureAccelerator('Control+Alt+N')).toBe(true)
    expect(isCaptureAccelerator('Alt+Shift+F12')).toBe(true)
    expect(isCaptureAccelerator('Control+C')).toBe(false)
    expect(isCaptureAccelerator('Alt+Control+N')).toBe(false)
    expect(isCaptureAccelerator('Control+Alt+N; rm')).toBe(false)
    expect(isCaptureAccelerator('CommandOrControl+Alt+N')).toBe(false)
  })

  test('modifier keys alone are not a shortcut yet', () => {
    expect(isModifierCode('ControlLeft')).toBe(true)
    expect(isModifierCode('AltRight')).toBe(true)
    expect(isModifierCode('KeyA')).toBe(false)
  })

  test('shows Control as Ctrl', () => {
    expect(shortcutLabel('Control+Alt+N')).toBe('Ctrl + Alt + N')
  })
})
