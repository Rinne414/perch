import { useLayoutEffect, useState, type RefObject } from 'react'

/** The core's drawing is 400 units across; the ports sit on this circle. */
export const CORE_UNITS = 400
export const PORT_RADIUS = 128
/** How far a side's ports spread above and below the horizontal, at most. */
const MAX_SPREAD_DEG = 36
const SPREAD_STEP_DEG = 12
/** How far each control point reaches toward the other end, as a share of the horizontal gap. */
const PULL = 0.55

/** Where a bay's wire runs; its colour comes from the bay's data when it is drawn. */
export interface WireGeometry {
  readonly key: string
  /** Cubic from the middle of the bay's inner edge to its port. */
  readonly d: string
  readonly start: { readonly x: number; readonly y: number }
  readonly port: { readonly x: number; readonly y: number }
}

export interface WireLayout {
  /** The map box's size; 0 before the first measure. */
  readonly width: number
  readonly height: number
  readonly wires: readonly WireGeometry[]
}

const EMPTY: WireLayout = { width: 0, height: 0, wires: [] }

/** Port angles of one side, top bay first: spread evenly within ±min(36, 12 × (n − 1)) degrees. */
function portAngles(n: number, side: 'left' | 'right'): number[] {
  const spread = Math.min(MAX_SPREAD_DEG, SPREAD_STEP_DEG * (n - 1))
  return Array.from({ length: n }, (_, i) => {
    const offset = n === 1 ? 0 : spread - (2 * spread * i) / (n - 1)
    const deg = side === 'left' ? 180 + offset : -offset
    return (deg * Math.PI) / 180
  })
}

interface Measured {
  readonly key: string
  readonly rect: DOMRect
}

function sideWires(bays: readonly Measured[], side: 'left' | 'right', box: DOMRect, center: { x: number; y: number }, radius: number): WireGeometry[] {
  const angles = portAngles(bays.length, side)
  return bays.map((b, i) => {
    const sx = (side === 'left' ? b.rect.right : b.rect.left) - box.left
    const sy = b.rect.top + b.rect.height / 2 - box.top
    const px = center.x + radius * Math.cos(angles[i])
    const py = center.y + radius * Math.sin(angles[i])
    const k = PULL * (px - sx)
    const d = `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${(sx + k).toFixed(1)} ${sy.toFixed(1)}, ${(px - k).toFixed(1)} ${py.toFixed(1)}, ${px.toFixed(1)} ${py.toFixed(1)}`
    return { key: b.key, d, start: { x: sx, y: sy }, port: { x: px, y: py } }
  })
}

function measure(map: HTMLElement, core: Element | null): WireLayout {
  const box = map.getBoundingClientRect()
  if (!core) return { width: box.width, height: box.height, wires: [] }
  const c = core.getBoundingClientRect()
  const center = { x: c.left + c.width / 2 - box.left, y: c.top + c.height / 2 - box.top }
  const radius = (PORT_RADIUS * c.width) / CORE_UNITS
  const of = (side: 'left' | 'right'): Measured[] =>
    [...map.querySelectorAll<HTMLElement>(`[data-bay-side="${side}"]`)].map((el) => ({
      key: el.dataset.bayKey ?? '',
      rect: el.getBoundingClientRect(),
    }))
  return {
    width: box.width,
    height: box.height,
    wires: [...sideWires(of('left'), 'left', box, center, radius), ...sideWires(of('right'), 'right', box, center, radius)],
  }
}

/**
 * Measures where each bay's wire runs: from the DOM, again whenever the map box changes size or
 * `version` changes (new data, a bay opened). Bays carry data-bay-side and data-bay-key.
 */
export function useWires(mapRef: RefObject<HTMLElement | null>, coreRef: RefObject<Element | null>, version: string): WireLayout {
  const [layout, setLayout] = useState<WireLayout>(EMPTY)
  useLayoutEffect(() => {
    const map = mapRef.current
    if (!map) return
    let frame = 0
    const update = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setLayout(measure(map, coreRef.current)))
    }
    setLayout(measure(map, coreRef.current))
    const observer = new ResizeObserver(update)
    observer.observe(map)
    map.querySelectorAll('[data-bay-side]').forEach((el) => observer.observe(el))
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [mapRef, coreRef, version])
  return layout
}
