import { useId, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react'
import type { MithPlane } from '../mith/types'

/**
 * Grid node look, after Make.com's scenario grid: each node is an extruded
 * block with a lit top face, darker side faces, and a soft contact shadow on
 * the board. The shape and color come from the entity type, and every node of
 * a type looks the same.
 *
 * | kind   | entity types                                          | shape          | color  |
 * | ------ | ----------------------------------------------------- | -------------- | ------ |
 * | org    | HoldingCompany, BankCore, TrustBank, … (default)      | hexagonal prism | violet |
 * | net    | TransitNetwork, InternetEdge, CorpVLAN, DMZ, BranchVLAN, NetworkRef | cylinder puck | teal |
 * | fw     | Firewall                                              | triangular prism | rose  |
 * | server | Server, CloudRole                                     | tall rounded block | sky |
 * | node   | NetworkDevice, Workstation, Cluster                   | low rounded tile | green |
 * | person | Person                                                | tall 12-sided post | indigo |
 * | role   | Role                                                  | flat diamond   | purple |
 * | actor  | ExternalActor                                         | pentagonal prism | red  |
 *
 * System and SaaS draw as the server block.
 *
 * Shapes are drawn in screen space, as isometric SVG, on a billboard that
 * stands up from the placement point. Nothing dips below the board surface, so
 * the board never hides part of a node.
 */
export type NodeKind = 'org' | 'net' | 'fw' | 'node' | 'server' | 'person' | 'role' | 'actor'

export function iconKind(type: string): NodeKind {
  if (type === 'Firewall') return 'fw'
  if (['TransitNetwork', 'InternetEdge', 'CorpVLAN', 'DMZ', 'BranchVLAN', 'NetworkRef'].includes(type)) return 'net'
  if (['Server', 'CloudRole', 'System', 'SaaS'].includes(type)) return 'server'
  if (['NetworkDevice', 'Workstation', 'Cluster'].includes(type)) return 'node'
  if (type === 'Person') return 'person'
  if (type === 'Role') return 'role'
  if (type === 'ExternalActor') return 'actor'
  return 'org'
}

type Shape = { kind: 'poly'; sides: number; r: number; start: number } | { kind: 'puck'; r: number }

const SHAPES: Record<NodeKind, { shape: Shape; depth: number; color: string; label: string }> = {
  org: { shape: { kind: 'poly', sides: 6, r: 14.5, start: 0 }, depth: 8, color: '#7b5cf2', label: 'hex-prism' },
  net: { shape: { kind: 'puck', r: 14 }, depth: 7, color: '#17a2b2', label: 'puck' },
  fw: { shape: { kind: 'poly', sides: 3, r: 16.5, start: -90 }, depth: 9, color: '#e0457b', label: 'tri-prism' },
  server: { shape: { kind: 'poly', sides: 4, r: 15.5, start: 45 }, depth: 12, color: '#3b93dd', label: 'block' },
  node: { shape: { kind: 'poly', sides: 4, r: 14.5, start: 45 }, depth: 5, color: '#3f9a6b', label: 'tile' },
  person: { shape: { kind: 'poly', sides: 12, r: 11.5, start: 0 }, depth: 13, color: '#5b63e6', label: 'post' },
  role: { shape: { kind: 'poly', sides: 4, r: 15.5, start: 0 }, depth: 5, color: '#9a5cf0', label: 'diamond' },
  actor: { shape: { kind: 'poly', sides: 5, r: 14.5, start: -90 }, depth: 9, color: '#d8363a', label: 'pent-prism' },
}

export function nodeShapeOf(type: string) {
  return SHAPES[iconKind(type)].label
}

// Screen-space isometric projection that matches the grid camera.
const YAW = (-28 * Math.PI) / 180
const SQUASH = Math.cos((54 * Math.PI) / 180)
const W = 48
const H = 42
const CX = 24
const CY = 15

function mix(hex: string, other: string, t: number) {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const b = [1, 3, 5].map((i) => parseInt(other.slice(i, i + 2), 16))
  return `rgb(${a.map((v, i) => Math.round(v + ((b[i] ?? v) - v) * t)).join(', ')})`
}

function project(x: number, y: number, dy = 0) {
  const rx = x * Math.cos(YAW) - y * Math.sin(YAW)
  const ry = x * Math.sin(YAW) + y * Math.cos(YAW)
  return { x: CX + rx, y: CY + ry * SQUASH + dy }
}

function polyPoints(sides: number, r: number, start: number, dy = 0) {
  return Array.from({ length: sides }, (_, i) => {
    const a = ((start + (360 / sides) * i) * Math.PI) / 180
    return project(r * Math.cos(a), r * Math.sin(a), dy)
  })
}

const fmt = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

export function Node3D({ type, children }: { type: string; children?: ReactNode }) {
  const kind = iconKind(type)
  const gradId = useId()
  const { shape, depth, color, label } = SHAPES[kind]
  const top = mix(color, '#ffffff', 0.12)
  const left = mix(color, '#1b1033', 0.34)
  const right = mix(color, '#1b1033', 0.2)
  const rim = mix(color, '#ffffff', 0.38)
  const glyph = `translate(${CX} ${CY}) scale(1 ${SQUASH.toFixed(3)}) rotate(-28) scale(0.78) translate(-8 -8)`
  let body: ReactNode
  if (shape.kind === 'puck') {
    const ry = shape.r * SQUASH
    body = (
      <>
        <defs>
          <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={left} />
            <stop offset="0.7" stopColor={right} />
            <stop offset="1" stopColor={left} />
          </linearGradient>
        </defs>
        <ellipse cx={CX} cy={CY + depth} rx={shape.r} ry={ry} fill={`url(#${gradId})`} />
        <rect x={CX - shape.r} y={CY} width={shape.r * 2} height={depth} fill={`url(#${gradId})`} />
        <ellipse cx={CX} cy={CY} rx={shape.r} ry={ry} fill={top} stroke={rim} strokeWidth={0.8} />
      </>
    )
  } else {
    const upper = polyPoints(shape.sides, shape.r, shape.start)
    const lower = polyPoints(shape.sides, shape.r, shape.start, depth)
    body = (
      <>
        <polygon points={fmt(lower)} fill={left} stroke={left} strokeWidth={3} strokeLinejoin="round" />
        {upper.map((p, i) => {
          const q = upper[(i + 1) % upper.length]!
          const face = [p, q, lower[(i + 1) % lower.length]!, lower[i]!]
          // Faces that lean right catch more light than faces that lean left.
          const fill = q.x - p.x > 0 ? right : left
          return <polygon key={i} points={fmt(face)} fill={fill} stroke={fill} strokeWidth={3} strokeLinejoin="round" />
        })}
        <polygon points={fmt(upper)} fill={top} stroke={top} strokeWidth={3} strokeLinejoin="round" />
        <polygon points={fmt(upper)} fill="none" stroke={rim} strokeWidth={0.8} strokeLinejoin="round" />
      </>
    )
  }
  return (
    <svg className="make-node3d" data-shape={label} width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {body}
      <g transform={glyph} color="#ffffff">{children}</g>
    </svg>
  )
}

type Anchor = { x: number; y: number }

/**
 * Screen positions of each board's front-edge anchor, relative to the stage.
 * `measureKey` changes whenever the camera or the visible boards change.
 */
export function useBoardAnchors(stageRef: RefObject<HTMLDivElement | null>, measureKey: string) {
  const [anchors, setAnchors] = useState<Map<string, Anchor>>(new Map())
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = () => {
      const box = stage.getBoundingClientRect()
      const next = new Map<string, Anchor>()
      stage.querySelectorAll<HTMLElement>('[data-board-anchor]').forEach((el) => {
        const id = el.dataset.boardAnchor
        if (!id) return
        const r = el.getBoundingClientRect()
        next.set(id, { x: Math.round(r.left + r.width / 2 - box.left), y: Math.round(r.top + r.height / 2 - box.top) })
      })
      setAnchors((prev) => {
        if (prev.size === next.size && [...next].every(([id, a]) => prev.get(id)?.x === a.x && prev.get(id)?.y === a.y)) return prev
        return next
      })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [stageRef, measureKey])
  return anchors
}

function FolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.8 4.2 C1.8 3.5 2.3 3 3 3 H6.2 L7.6 4.5 H13 C13.7 4.5 14.2 5 14.2 5.7 V12 C14.2 12.7 13.7 13.2 13 13.2 H3 C2.3 13.2 1.8 12.7 1.8 12 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Board-folder tags live in a screen-space layer above the boards, edges, and
 * arcs. That way a tilted board plane can never occlude them, which is what
 * clipped the old in-plane label.
 */
export function BoardTags({ planes, anchors, focusId }: { planes: MithPlane[]; anchors: Map<string, Anchor>; focusId: string | null }) {
  return (
    <div className="make-board-tags" aria-hidden="true">
      {planes.map((plane) => {
        const a = anchors.get(plane.id)
        if (!a) return null
        return (
          <span
            key={plane.id}
            className={`make-board-tag ${plane.id === focusId ? 'is-focus' : ''}`}
            data-board-tag={plane.id}
            style={{ left: a.x, top: a.y }}
          >
            <FolderIcon />
            {plane.label}
          </span>
        )
      })}
    </div>
  )
}
