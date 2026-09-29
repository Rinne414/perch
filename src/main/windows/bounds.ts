import { screen, type BrowserWindow, type Rectangle } from 'electron'

export type SavedBounds = Partial<Rectangle> & { width: number; height: number }

const SAVE_DELAY_MS = 400

/** Drops a saved position that no longer lands on any screen (a monitor was unplugged). */
export function onScreen(bounds: SavedBounds): SavedBounds {
  if (bounds.x === undefined || bounds.y === undefined) return bounds
  const rect = bounds as Rectangle
  const visible = screen.getAllDisplays().some(({ workArea: a }) => {
    return rect.x < a.x + a.width && rect.x + rect.width > a.x && rect.y < a.y + a.height && rect.y + 40 > a.y
  })
  return visible ? bounds : { width: bounds.width, height: bounds.height }
}

/** Calls `save` with the window's normal bounds shortly after it stops moving or resizing. */
export function watchBounds(win: BrowserWindow, save: (bounds: Rectangle) => void): void {
  let timer: NodeJS.Timeout | undefined
  const schedule = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!win.isDestroyed()) save(win.getNormalBounds())
    }, SAVE_DELAY_MS)
  }
  win.on('moved', schedule)
  win.on('resized', schedule)
}
