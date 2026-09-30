import type { BrowserWindowConstructorOptions } from 'electron'

/** The navy the page tints the glass with, used as a solid colour where there is no system blur. */
const GLASS_BASE = '#0d1120'

/**
 * The blur behind the glass comes from the system: acrylic on Windows 11, vibrancy on macOS.
 * Linux has no blur a window can ask for, and a transparent window without a compositor turns
 * black, so there the window is solid and the page's navy tint reads the same.
 */
export function glassWindowOptions(platform: NodeJS.Platform = process.platform): Partial<BrowserWindowConstructorOptions> {
  if (platform === 'win32') return { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' }
  if (platform === 'darwin') return { vibrancy: 'under-window', visualEffectState: 'active', backgroundColor: '#00000000' }
  return { backgroundColor: GLASS_BASE }
}
