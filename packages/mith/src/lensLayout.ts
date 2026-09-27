import { orgModel } from './org'
import type { MithDocument } from './types'

/** Lenses over one document. `layers` is the original plane-board view. */
export type Lens = 'layers' | 'org' | 'network' | 'access' | 'impersonation' | 'shadow'
/** Which dimension draws the nested frames. */
export type FrameDim = 'org' | 'network'

export const LENSES: { id: Lens; label: string }[] = [
  { id: 'org', label: 'Org' },
  { id: 'network', label: 'Network' },
  { id: 'access', label: 'Access' },
  { id: 'impersonation', label: 'Impersonation' },
  { id: 'shadow', label: 'Shadow IT' },
  { id: 'layers', label: 'Layers' },
]

export type LensFrameKind =
  | 'company'
  | 'subsidiary'
  | 'department'
  | 'team'
  | 'zone'
  | 'unassigned'
  | 'external'
  | 'shadow'

export type LensFrame = {
  id: string
  label: string
  kind: LensFrameKind
  depth: number
  x: number
  y: number
  w: number
  h: number
  /** Dashed frames sit outside the sanctioned org boundary. */
  dashed: boolean
}

export type LensItemKind = 'entity' | 'role' | 'actor' | 'shadow'

export type LensItem = {
  id: string
  label: string
  kind: LensItemKind
  type: string
  frame: string
  /** Nesting depth of the host frame, so the item sits just above it. */
  depth: number
  x: number
  y: number
}

export type LensLayout = {
  width: number
  height: number
  frames: LensFrame[]
  items: LensItem[]
}

const CELL_W = 190
const CELL_H = 44
const PAD = 14
/** Header band that holds the screen-space frame tag. Containers get more so nested tags do not stack. */
const HEAD = 40
const HEAD_CONTAINER = 64
const GAP = 16
const MIN_W = 150
const MIN_H = 96
const OUTSIDE_GAP = 64

type Node = {
  id: string
  label: string
  kind: LensFrameKind
  dashed: boolean
  children: Node[]
  items: Omit<LensItem, 'x' | 'y' | 'frame' | 'depth'>[]
  w: number
  h: number
  cols: number
  itemsH: number
  rows: { nodes: Node[]; h: number }[]
}

function node(id: string, label: string, kind: LensFrameKind, dashed = false): Node {
  return { id, label, kind, dashed, children: [], items: [], w: 0, h: 0, cols: 0, itemsH: 0, rows: [] }
}

function headOf(n: Node) {
  return n.children.length ? HEAD_CONTAINER : HEAD
}

function measure(n: Node) {
  n.children.forEach(measure)
  const count = n.items.length
  n.cols = count ? Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count * 0.5)))) : 0
  const itemRows = n.cols ? Math.ceil(count / n.cols) : 0
  const itemsW = n.cols * CELL_W
  n.itemsH = itemRows * CELL_H
  const area = n.children.reduce((sum, c) => sum + c.w * c.h, 0)
  const widest = n.children.reduce((m, c) => Math.max(m, c.w), 0)
  const target = Math.max(itemsW, widest, Math.sqrt(area) * 1.35)
  n.rows = []
  let row: Node[] = []
  let rowW = 0
  for (const c of n.children) {
    if (row.length && rowW + GAP + c.w > target) {
      n.rows.push({ nodes: row, h: Math.max(...row.map((r) => r.h)) })
      row = []
      rowW = 0
    }
    rowW += (row.length ? GAP : 0) + c.w
    row.push(c)
  }
  if (row.length) n.rows.push({ nodes: row, h: Math.max(...row.map((r) => r.h)) })
  const rowsW = n.rows.reduce((m, r) => Math.max(m, r.nodes.reduce((s, c) => s + c.w, 0) + GAP * (r.nodes.length - 1)), 0)
  const rowsH = n.rows.reduce((s, r) => s + r.h, 0) + GAP * Math.max(0, n.rows.length - 1)
  // Wide enough for the kind tag plus the full label, so frame labels never truncate.
  const labelW = 64 + n.label.length * 7
  n.w = Math.max(MIN_W, labelW, PAD * 2 + Math.max(itemsW, rowsW))
  n.h = Math.max(MIN_H, headOf(n) + PAD + n.itemsH + (n.itemsH && rowsH ? GAP : 0) + rowsH)
}

function place(n: Node, x: number, y: number, depth: number, frames: LensFrame[], items: LensItem[]) {
  frames.push({ id: n.id, label: n.label, kind: n.kind, depth, x, y, w: n.w, h: n.h, dashed: n.dashed })
  n.items.forEach((item, i) => {
    const c = i % n.cols
    const r = Math.floor(i / n.cols)
    items.push({ ...item, frame: n.id, depth, x: x + PAD + 18 + c * CELL_W, y: y + headOf(n) + r * CELL_H + CELL_H / 2 - 4 })
  })
  let cy = y + headOf(n) + n.itemsH + (n.itemsH && n.rows.length ? GAP : 0)
  for (const row of n.rows) {
    let cx = x + PAD
    for (const c of row.nodes) {
      place(c, cx, cy, depth + 1, frames, items)
      cx += c.w + GAP
    }
    cy += row.h + GAP
  }
}

function packRoots(roots: Node[], frames: LensFrame[], items: LensItem[], x0: number) {
  let x = x0
  let h = 0
  for (const r of roots) {
    place(r, x, 0, 0, frames, items)
    x += r.w + OUTSIDE_GAP
    h = Math.max(h, r.h)
  }
  return { right: x - OUTSIDE_GAP, height: h }
}

function withRoles(lens: Lens) {
  return lens === 'access' || lens === 'impersonation'
}

/**
 * Nested frames for one lens. Org framing nests company > subsidiary > department > team.
 * Network framing nests zones by each network entity's own `zone`. External actors sit in a
 * dashed frame left of the org; unsanctioned systems sit in dashed frames to the right.
 */
export function lensLayout(doc: MithDocument, lens: Lens, dim: FrameDim): LensLayout {
  const { boundaries, roles, actors } = orgModel(doc)
  const frames: LensFrame[] = []
  const items: LensItem[] = []
  const containers = new Map<string, Node>()
  const roots: Node[] = []
  const shadow = doc.model.entities.filter((e) => e.sanctioned === false)
  const unassigned = node(`unassigned:${dim}`, dim === 'org' ? 'No org boundary' : 'No network zone', 'unassigned', true)

  if (dim === 'org') {
    for (const b of boundaries) containers.set(b.id, node(b.id, b.label, b.kind))
    for (const b of boundaries) {
      const n = containers.get(b.id)!
      const parent = b.parent ? containers.get(b.parent) : undefined
      if (parent) parent.children.push(n)
      else roots.push(n)
    }
    for (const e of doc.model.entities) {
      if (e.sanctioned === false) continue
      // Impersonation reads actor → role → role; people are represented by the roles they hold.
      if (lens === 'impersonation' && e.type === 'Person') continue
      const host = e.boundary ? containers.get(e.boundary) : undefined
      const item = { id: e.id, label: e.label, kind: 'entity' as const, type: e.type }
      if (host) host.items.push(item)
      else if (e.layer !== 'network' && e.layer !== 'firewall') unassigned.items.push(item)
    }
  } else {
    const zones = doc.model.entities.filter((e) => e.layer === 'network')
    for (const z of zones) containers.set(z.id, node(z.id, z.label, 'zone'))
    for (const z of zones) {
      const n = containers.get(z.id)!
      const parent = z.zone ? containers.get(z.zone) : undefined
      if (parent) parent.children.push(n)
      else roots.push(n)
    }
    for (const e of doc.model.entities) {
      if (e.layer === 'network') continue
      const host = e.zone ? containers.get(e.zone) : undefined
      const item = { id: e.id, label: e.label, kind: e.sanctioned === false ? ('shadow' as const) : ('entity' as const), type: e.type }
      if (host) host.items.push(item)
      else unassigned.items.push(item)
    }
  }

  if (withRoles(lens)) {
    for (const r of roles) {
      const item = { id: r.id, label: r.label, kind: 'role' as const, type: 'Role' }
      const host = dim === 'org' ? containers.get(r.boundary) : undefined
      if (host) host.items.push(item)
      else unassigned.items.push(item)
    }
  }
  if (unassigned.items.length) roots.push(unassigned)
  roots.forEach(measure)

  let left = 0
  if (lens === 'impersonation' && actors.length) {
    const outside = node('outside:actors', 'Outside the org (synthetic)', 'external', true)
    outside.items = actors.map((a) => ({ id: a.id, label: a.label, kind: 'actor' as const, type: 'ExternalActor' }))
    measure(outside)
    // One column, so paths read left to right into the org.
    outside.cols = 1
    outside.itemsH = outside.items.length * CELL_H
    outside.w = Math.max(MIN_W, 64 + outside.label.length * 7, PAD * 2 + CELL_W)
    outside.h = Math.max(MIN_H, HEAD + PAD + outside.itemsH)
    place(outside, 0, 0, 0, frames, items)
    left = outside.w + OUTSIDE_GAP * 1.5
  }

  const packed = packRoots(roots, frames, items, left)
  let right = packed.right
  let height = packed.height

  if (dim === 'org' && shadow.length) {
    let y = 0
    const x = right + OUTSIDE_GAP
    let w = 0
    for (const e of shadow) {
      const n = node(`shadow:${e.id}`, e.source ?? 'unknown', 'shadow', true)
      n.items.push({ id: e.id, label: e.label, kind: 'shadow', type: e.type })
      measure(n)
      place(n, x, y, 0, frames, items)
      y += n.h + GAP * 2.5
      w = Math.max(w, n.w)
    }
    right = x + w
    height = Math.max(height, y - GAP * 2.5)
  }

  return { width: Math.max(right, MIN_W), height: Math.max(height, MIN_H), frames, items }
}
