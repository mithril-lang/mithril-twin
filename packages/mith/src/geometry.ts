import type { MithDocument, MithPlane } from './types'

/** Pixel size of one board on the shared floor. Diagram x/y use the same space. */
export const COPLANAR_BOARD_W = 280
export const COPLANAR_BOARD_H = 176

export type CoplanarFloor = {
  width: number
  height: number
  boards: { id: string; x: number; y: number }[]
}

/** Plane that owns an entity: matching layer first, then the first placement. */
export function boardForEntity(
  planes: MithPlane[],
  entityId: string,
  entityLayer?: string,
): MithPlane | undefined {
  const hosts = planes.filter((p) => p.placements.some((pl) => pl.entity === entityId))
  return hosts.find((p) => entityLayer != null && p.layer === entityLayer) ?? hosts[0]
}

export type ScreenBox = { left: number; top: number; right: number; bottom: number }

/**
 * Pan and, when needed, zoom out so the board bounding box sits inside `safe`.
 * Scale is about `stageCenter`. Translate is in screen pixels and is not scaled.
 * Returns null when the boards are already inside.
 */
export function fitBoardsInSafeArea(args: {
  zoom: number
  pan: { x: number; y: number }
  content: ScreenBox
  safe: ScreenBox
  stageCenter: { x: number; y: number }
}): { zoom: number; pan: { x: number; y: number } } | null {
  const { zoom, pan, content, safe, stageCenter } = args
  const width = content.right - content.left
  const height = content.bottom - content.top
  const safeWidth = safe.right - safe.left
  const safeHeight = safe.bottom - safe.top
  if (width < 1 || height < 1 || safeWidth < 1 || safeHeight < 1) return null

  const slack = 2
  const inside =
    content.left >= safe.left - slack &&
    content.right <= safe.right + slack &&
    content.top >= safe.top - slack &&
    content.bottom <= safe.bottom + slack
  if (inside) return null

  const k = Math.min(1, safeWidth / width, safeHeight / height)
  const center = {
    x: (content.left + content.right) / 2,
    y: (content.top + content.bottom) / 2,
  }
  const safeCenter = {
    x: (safe.left + safe.right) / 2,
    y: (safe.top + safe.bottom) / 2,
  }
  let dx: number
  let dy: number
  if (k < 0.999) {
    const scaled = {
      x: stageCenter.x + k * (center.x - stageCenter.x - pan.x) + pan.x,
      y: stageCenter.y + k * (center.y - stageCenter.y - pan.y) + pan.y,
    }
    dx = safeCenter.x - scaled.x
    dy = safeCenter.y - scaled.y
  } else {
    dx = 0
    dy = 0
    if (content.left < safe.left) dx += safe.left - content.left
    if (content.right + dx > safe.right) dx += safe.right - (content.right + dx)
    if (content.top < safe.top) dy += safe.top - content.top
    if (content.bottom + dy > safe.bottom) dy += safe.bottom - (content.bottom + dy)
  }

  const nextZoom = Math.round(zoom * k * 1000) / 1000
  const nextPan = {
    x: Math.round((pan.x + dx) * 10) / 10,
    y: Math.round((pan.y + dy) * 10) / 10,
  }
  if (Math.abs(nextZoom - zoom) < 0.001 && Math.abs(nextPan.x - pan.x) < 0.5 && Math.abs(nextPan.y - pan.y) < 0.5) {
    return null
  }
  return { zoom: nextZoom, pan: nextPan }
}

/** Lay every board on one floor. XY come from transforms; Z is not a stair. */
export function coplanarFloor(planes: MithPlane[]): CoplanarFloor {
  if (!planes.length) {
    return { width: COPLANAR_BOARD_W, height: COPLANAR_BOARD_H, boards: [] }
  }
  const minX = Math.min(...planes.map((p) => p.transform.x))
  const minY = Math.min(...planes.map((p) => p.transform.y))
  const maxX = Math.max(...planes.map((p) => p.transform.x))
  const maxY = Math.max(...planes.map((p) => p.transform.y))
  return {
    width: maxX - minX + COPLANAR_BOARD_W,
    height: maxY - minY + COPLANAR_BOARD_H,
    boards: planes.map((p) => ({
      id: p.id,
      x: p.transform.x - minX,
      y: p.transform.y - minY,
    })),
  }
}

/** Index of the first plane in the 3-plane window around `focusIndex`. */
export function windowStart(focusIndex: number, count: number, window = 3): number {
  const maxStart = Math.max(0, count - window)
  const focus = Math.min(Math.max(0, focusIndex), Math.max(0, count - 1))
  return Math.min(Math.max(0, focus - 1), maxStart)
}

export function visiblePlanes(planes: MithPlane[], focusId: string | null): MithPlane[] {
  if (!planes.length) return []
  const idx = focusId ? planes.findIndex((p) => p.id === focusId) : 0
  const start = windowStart(idx < 0 ? 0 : idx, planes.length)
  return planes.slice(start, start + 3)
}

/** Screen-space quadratic used for cross-plane curves (Make grid arcs). */
export function crossArcPath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const mx = (a.x + b.x) / 2
  const lift = Math.max(56, Math.abs(a.x - b.x) * 0.28 + Math.abs(a.y - b.y) * 0.15)
  const my = Math.min(a.y, b.y) - lift
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
}

export function gridPositions(count: number): { x: number; y: number }[] {
  if (count <= 0) return []
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < count; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    out.push({
      x: Number((0.14 + ((c + 0.5) / cols) * 0.72).toFixed(3)),
      y: Number((0.18 + ((r + 0.5) / rows) * 0.64).toFixed(3)),
    })
  }
  return out
}

export function entityById(doc: MithDocument) {
  return new Map(doc.model.entities.map((e) => [e.id, e]))
}

/** Entity ids placed on more than one plane. */
export function sharedEntityIds(doc: MithDocument): Set<string> {
  const counts = new Map<string, number>()
  for (const plane of doc.diagram.planes) {
    const seen = new Set<string>()
    for (const p of plane.placements) {
      if (seen.has(p.entity)) continue
      seen.add(p.entity)
      counts.set(p.entity, (counts.get(p.entity) ?? 0) + 1)
    }
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id))
}

export type ResolvedLink = {
  id: string
  kind: string
  otherId: string
  direction: 'out' | 'in' | 'cross'
}

export function linksFor(doc: MithDocument, entityId: string): ResolvedLink[] {
  const links: ResolvedLink[] = []
  for (const edge of doc.model.edges) {
    if (edge.source === entityId) {
      links.push({ id: edge.id, kind: edge.kind, otherId: edge.target, direction: 'out' })
    } else if (edge.target === entityId) {
      links.push({ id: edge.id, kind: edge.kind, otherId: edge.source, direction: 'in' })
    }
  }
  for (const link of doc.diagram.crossLinks) {
    if (link.from === entityId) {
      links.push({ id: link.id, kind: link.kind, otherId: link.to, direction: 'cross' })
    } else if (link.to === entityId) {
      links.push({ id: link.id, kind: link.kind, otherId: link.from, direction: 'cross' })
    }
  }
  return links
}
