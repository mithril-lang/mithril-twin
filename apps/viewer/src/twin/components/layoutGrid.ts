import type { GraphItem } from '../data/types'

export type LaidOutNode = GraphItem & { x: number; y: number }

/**
 * Deterministic grid layout inside a board plane.
 * Groups by type into columns, rows within column.
 */
export function layoutOnGrid(
  nodes: GraphItem[],
  width: number,
  height: number,
  pad = 48,
  header = 0,
): LaidOutNode[] {
  if (nodes.length === 0) return []
  const byType = new Map<string, GraphItem[]>()
  for (const n of nodes) {
    const t = n.data.type || 'Other'
    if (!byType.has(t)) byType.set(t, [])
    byType.get(t)!.push(n)
  }
  const types = [...byType.keys()]
  const cols = Math.max(1, Math.min(types.length, Math.ceil(Math.sqrt(nodes.length))))
  const colW = (width - pad * 2) / cols
  const top = pad + header
  const out: LaidOutNode[] = []

  types.forEach((type, ti) => {
    const group = byType.get(type)!
    const col = ti % cols
    const colIndex = Math.floor(ti / cols)
    const rowsInCol = group.length
    const usableH = Math.max(48, height - top - pad)
    const rowH = Math.max(64, usableH / Math.max(rowsInCol, 1))
    group.forEach((n, ri) => {
      const x = pad + col * colW + colW / 2 + (colIndex % 2) * 6
      const y = top + ri * rowH + rowH * 0.36
      out.push({ ...n, x, y })
    })
  })
  return out
}

/**
 * Even grid with a minimum cell width so upright labels do not share a column.
 * Used by the overview pools.
 */
export function layoutSpread(
  nodes: GraphItem[],
  width: number,
  height: number,
  pad = 24,
  header = 0,
  minCell = 200,
): LaidOutNode[] {
  const n = nodes.length
  if (n === 0) return []
  const innerW = Math.max(minCell, width - pad * 2)
  const innerH = Math.max(72, height - header - pad)
  const cols = Math.max(1, Math.min(n, Math.floor(innerW / minCell)))
  const rows = Math.ceil(n / cols)
  const cellW = innerW / cols
  const cellH = innerH / rows
  return nodes.map((node, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    return {
      ...node,
      x: pad + c * cellW + cellW / 2,
      y: header + r * cellH + cellH * 0.4,
    }
  })
}

/** Single upright row. Used by the flat layer board so labels do not stack. */
export function layoutRow(
  nodes: GraphItem[],
  width: number,
  height: number,
  padX = 28,
  header = 0,
): LaidOutNode[] {
  const n = nodes.length
  if (n === 0) return []
  const inner = Math.max(1, width - padX * 2)
  const gap = inner / n
  const y = header + Math.max(36, (height - header) * 0.42)
  return nodes.map((node, i) => ({
    ...node,
    x: padX + gap * i + gap / 2,
    y,
  }))
}

/** Simple force-free multipartite vertical stack positions for stacked view. */
export function layoutMultipartite(
  nodes: GraphItem[],
  width: number,
  height: number,
  pad = 40,
): LaidOutNode[] {
  const n = nodes.length
  if (n === 0) return []
  const cols = Math.ceil(Math.sqrt(n * 1.4))
  const rows = Math.ceil(n / cols)
  const cellW = (width - pad * 2) / cols
  const cellH = (height - pad * 2) / rows
  return nodes.map((node, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    return {
      ...node,
      x: pad + c * cellW + cellW / 2,
      y: pad + r * cellH + cellH / 2,
    }
  })
}
