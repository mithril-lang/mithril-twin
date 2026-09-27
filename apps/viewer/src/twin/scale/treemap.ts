export type Rect = { x: number; y: number; w: number; h: number }
export type Tile<T> = Rect & { item: T }

/** Squarified treemap (Bruls et al.). Deterministic; values ≤ 0 get a small floor. */
export function treemap<T>(items: T[], value: (t: T) => number, rect: Rect): Tile<T>[] {
  const total = items.reduce((a, t) => a + Math.max(value(t), 1e-6), 0)
  if (!items.length || rect.w <= 0 || rect.h <= 0) return []
  const scale = (rect.w * rect.h) / total
  const nodes = items
    .map((item) => ({ item, area: Math.max(value(item), 1e-6) * scale }))
    .sort((a, b) => b.area - a.area)
  const out: Tile<T>[] = []
  let { x, y, w, h } = rect
  let row: typeof nodes = []
  const worst = (list: typeof nodes, side: number) => {
    const s = list.reduce((a, n) => a + n.area, 0)
    let max = 0
    let min = Infinity
    for (const n of list) {
      max = Math.max(max, n.area)
      min = Math.min(min, n.area)
    }
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min))
  }
  const layoutRow = (list: typeof nodes) => {
    const s = list.reduce((a, n) => a + n.area, 0)
    if (w >= h) {
      const cw = s / h
      let cy = y
      for (const n of list) {
        const ch = n.area / cw
        out.push({ item: n.item, x, y: cy, w: cw, h: ch })
        cy += ch
      }
      x += cw
      w -= cw
    } else {
      const ch = s / w
      let cx = x
      for (const n of list) {
        const cw = n.area / ch
        out.push({ item: n.item, x: cx, y, w: cw, h: ch })
        cx += cw
      }
      y += ch
      h -= ch
    }
  }
  for (const n of nodes) {
    const side = Math.min(w, h)
    if (!row.length || worst([...row, n], side) <= worst(row, side)) {
      row.push(n)
    } else {
      layoutRow(row)
      row = [n]
    }
  }
  if (row.length) layoutRow(row)
  return out
}

/** Shrink a rect by padding on every side and reserve `head` on top. */
export function inset(r: Rect, pad: number, head = 0): Rect {
  return { x: r.x + pad, y: r.y + pad + head, w: Math.max(0, r.w - 2 * pad), h: Math.max(0, r.h - 2 * pad - head) }
}
