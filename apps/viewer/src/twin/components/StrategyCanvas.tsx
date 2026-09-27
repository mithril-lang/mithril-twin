import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as REPointerEvent, type WheelEvent as REWheelEvent } from 'react'
import type { AttackScenario, GraphItem, SelectMode } from '../data/types'
import { BOUNDARY_BOARDS, slimNodes, subsetForBoard } from '../data/boards'
import { edgeMatchesMode, nodeMatchesMode } from '../data/halo'
import { useTheme } from '../themes/ThemeContext'
import { edgeColor, nodeToken } from '../themes/index'
import TokenNode from './TokenNode'
import { layoutSpread } from './layoutGrid'
import { orthoPath } from './ortho'

type Props = {
  orgNodes: GraphItem[]
  orgEdges: GraphItem[]
  selectMode: SelectMode
  selectedId?: string | null
  onSelect: (item: GraphItem | null) => void
  onOpenBoard?: (boardId: string) => void
  attackScenario?: AttackScenario | null
  attackOverlayNodes?: GraphItem[]
  attackOverlayEdges?: GraphItem[]
}

/** Flat pools on one orthogonal board. Titles stay horizontal. */
const ZONE_LAYOUT: Record<string, { x: number; y: number; w: number; h: number }> = {
  holding: { x: 380, y: 20, w: 1272, h: 240 },
  'bank-core': { x: 24, y: 284, w: 810, h: 400 },
  'it-digital': { x: 854, y: 284, w: 798, h: 400 },
  regional: { x: 24, y: 708, w: 1628, h: 340 },
  'threat-entry': { x: 24, y: 20, w: 336, h: 240 },
}

const STAGE_W = 1680
const STAGE_H = 1070
const MIN_SCALE = 0.35
const MAX_SCALE = 2.4
const HEADER_H = 36
const READABLE_SCALE = 0.72

/** Keep hypothesis path endpoints on the board when a scenario is selected. */
function pinScenario(
  picked: GraphItem[],
  pool: GraphItem[],
  scenario: AttackScenario | null,
  max: number,
): GraphItem[] {
  if (!scenario) return picked
  const want = new Set(scenario.node_ids)
  const pinned = pool.filter((n) => want.has(n.data.id ?? ''))
  if (!pinned.length) return picked
  const seen = new Set(pinned.map((n) => n.data.id))
  const rest = picked.filter((n) => !seen.has(n.data.id))
  return [...pinned, ...rest].slice(0, Math.max(max, pinned.length))
}

type ZoneModel = {
  id: string
  label: string
  subtitle: string
  openable: boolean
  rect: { x: number; y: number; w: number; h: number }
  nodes: Array<GraphItem & { x: number; y: number }>
}

export default function StrategyCanvas({
  orgNodes, orgEdges, selectMode, selectedId, onSelect, onOpenBoard,
  attackScenario = null, attackOverlayNodes = [],
}: Props) {
  const { theme } = useTheme()
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(READABLE_SCALE)
  const [pan, setPan] = useState({ x: 12, y: 8 })
  const drag = useRef<{ px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null)
  const fitted = useRef(false)

  const fitBoard = useCallback(() => {
    const el = viewportRef.current
    const width = el?.clientWidth ?? 0
    const next = width > 80
      ? Math.max(MIN_SCALE, Math.min(1, (width - 16) / STAGE_W))
      : READABLE_SCALE
    setScale(next)
    setPan({ x: 12, y: 8 })
    return next
  }, [])

  useEffect(() => {
    if (fitted.current) return
    if ((viewportRef.current?.clientWidth ?? 0) < 80) return
    fitBoard()
    fitted.current = true
  }, [fitBoard])

  const zones = useMemo(() => {
    const base: ZoneModel[] = BOUNDARY_BOARDS.map((board) => {
      const rect = ZONE_LAYOUT[board.id] ?? { x: 0, y: 0, w: 400, h: 240 }
      const sub = subsetForBoard(orgNodes, orgEdges, board, board.id !== 'holding')
      const cap = 6
      const nodes = pinScenario(slimNodes(sub.nodes, cap), sub.nodes, attackScenario, cap)
      const laid = layoutSpread(nodes, rect.w, rect.h, 20, HEADER_H).map((n) => ({
        ...n,
        x: n.x + rect.x,
        y: n.y + rect.y,
      }))
      return {
        id: board.id,
        label: board.label,
        subtitle: board.subtitle,
        openable: true,
        rect,
        nodes: laid,
      }
    })
    if (attackScenario && attackOverlayNodes.length) {
      const rect = ZONE_LAYOUT['threat-entry']!
      const want = new Set(
        attackScenario.node_ids.filter((id) => id.startsWith('entry:') || id.startsWith('tech:') || id.startsWith('path:')),
      )
      const overlay = attackOverlayNodes.filter((n) => want.has(n.data.id ?? ''))
      const laid = layoutSpread(overlay, rect.w, rect.h, 16, HEADER_H, 120).map((n) => ({
        ...n,
        x: n.x + rect.x,
        y: n.y + rect.y,
      }))
      base.push({
        id: 'threat-entry',
        label: 'Threat entry',
        subtitle: 'hypothesis overlay',
        openable: false,
        rect,
        nodes: laid,
      })
    }
    return base
  }, [orgNodes, orgEdges, attackScenario, attackOverlayNodes])

  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number; item: GraphItem }>()
    for (const z of zones) {
      for (const n of z.nodes) {
        const id = n.data.id
        if (!id || m.has(id)) continue
        m.set(id, { x: n.x, y: n.y, item: n })
      }
    }
    return m
  }, [zones])

  const cables = useMemo(() => {
    const ids = new Set(pos.keys())
    return orgEdges.filter((e) => {
      const s = e.data.source
      const t = e.data.target
      return !!s && !!t && ids.has(s) && ids.has(t)
    })
  }, [orgEdges, pos])

  const onWheel = useCallback((e: REWheelEvent) => {
    e.preventDefault()
    const el = viewportRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const factor = -e.deltaY > 0 ? 1.08 : 1 / 1.08
    setScale((prev) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor))
      const ratio = next / prev
      setPan((p) => ({
        x: cx - (cx - p.x) * ratio,
        y: cy - (cy - p.y) * ratio,
      }))
      return next
    })
  }, [])

  const onPointerDown = (e: REPointerEvent) => {
    if (e.button !== 0) return
    const target = e.target as Element
    if (target.closest('.token-node, .strategy-zone-open, .strategy-zone-hit')) return
    drag.current = { px: e.clientX, py: e.clientY, ox: pan.x, oy: pan.y, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: REPointerEvent) => {
    if (!drag.current) return
    const dx = e.clientX - drag.current.px
    const dy = e.clientY - drag.current.py
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true
    setPan({ x: drag.current.ox + dx, y: drag.current.oy + dy })
  }

  const onPointerUp = (e: REPointerEvent) => {
    if (drag.current && !drag.current.moved) onSelect(null)
    drag.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* noop */ }
  }

  const resetView = () => {
    fitted.current = true
    fitBoard()
  }

  const labelScale = Math.min(1.75, Math.max(1, 1 / scale))

  return (
    <div className="strategy-canvas">
      <div className="strategy-canvas-hint">
        Flat overview. Pan the empty board, scroll to zoom. Open a zone to drill in.
      </div>
      <div className="strategy-toolbar">
        <button type="button" className="strategy-tool-btn" onClick={resetView}>Reset view</button>
        <span className="strategy-zoom-label">{Math.round(scale * 100)}%</span>
      </div>
      <div
        ref={viewportRef}
        className="strategy-viewport"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="application"
        aria-label="FI overview board"
      >
        <div
          className="strategy-stage"
          style={{
            width: STAGE_W,
            height: STAGE_H,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          <svg
            viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
            width={STAGE_W}
            height={STAGE_H}
            className="strategy-svg"
          >
            <defs>
              <pattern id="strategy-line-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="var(--tw-grid)" strokeWidth="1" />
              </pattern>
              <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M 0 1.4 L 9 5 L 0 8.6 Z" fill="context-stroke" />
              </marker>
            </defs>

            <rect x={0} y={0} width={STAGE_W} height={STAGE_H} className="strategy-floor" rx={8} />
            <rect x={0} y={0} width={STAGE_W} height={STAGE_H} fill="url(#strategy-line-grid)" rx={8} />

            {zones.map((zone) => (
              <g key={zone.id} className="strategy-zone" data-zone={zone.id}>
                <rect
                  x={zone.rect.x}
                  y={zone.rect.y}
                  width={zone.rect.w}
                  height={zone.rect.h}
                  className="strategy-zone-pad"
                  rx={8}
                />
                <rect
                  x={zone.rect.x}
                  y={zone.rect.y}
                  width={zone.rect.w}
                  height={HEADER_H}
                  className="strategy-zone-head"
                />
                <text x={zone.rect.x + 14} y={zone.rect.y + 23} className="strategy-zone-title">
                  {zone.label}
                </text>
                {zone.rect.w > 420 && (
                  <text x={zone.rect.x + 168} y={zone.rect.y + 23} className="strategy-zone-sub">
                    {zone.subtitle}
                  </text>
                )}
                {zone.openable && (
                  <rect
                    x={zone.rect.x}
                    y={zone.rect.y}
                    width={Math.min(220, zone.rect.w * 0.4)}
                    height={HEADER_H}
                    className="strategy-zone-hit"
                    fill="transparent"
                    style={{ cursor: 'pointer' }}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      onOpenBoard?.(zone.id)
                    }}
                  >
                    <title>Open organization drill-in</title>
                  </rect>
                )}
              </g>
            ))}

            <g className="strategy-cables">
              {cables.map((e) => {
                const sid = e.data.source
                const tid = e.data.target
                if (!sid || !tid) return null
                const s = pos.get(sid)
                const t = pos.get(tid)
                if (!s || !t) return null
                const col = edgeColor(theme, e.data.kind ?? '')
                const hot = edgeMatchesMode(selectMode, e.data.kind ?? '', {
                  scenario: attackScenario,
                  source: sid,
                  target: tid,
                })
                const d = orthoPath(s.x, s.y, t.x, t.y)
                return (
                  <g key={e.data.id}>
                    {hot && (
                      <path
                        d={d}
                        fill="none"
                        stroke={theme.halos[selectMode]}
                        strokeWidth={7}
                        opacity={0.55}
                        strokeLinejoin="round"
                      />
                    )}
                    <path
                      d={d}
                      fill="none"
                      stroke={col}
                      strokeWidth={hot ? 2.2 : 1.35}
                      strokeDasharray={e.data.kind === 'guards' ? '5 3' : undefined}
                      opacity={0.9}
                      strokeLinejoin="round"
                      markerEnd="url(#flow-arrow)"
                      onClick={(ev) => { ev.stopPropagation(); onSelect(e) }}
                      style={{ cursor: 'pointer' }}
                    />
                  </g>
                )
              })}
            </g>

            <g className="strategy-attack-steps">
              {attackScenario && attackScenario.steps.map((step, i) => {
                const s = pos.get(step.from)
                const tpos = pos.get(step.to)
                if (!s || !tpos) return null
                return (
                  <path
                    key={`atk-${i}`}
                    d={orthoPath(s.x, s.y, tpos.x, tpos.y)}
                    fill="none"
                    stroke={theme.halos.attackPath}
                    strokeWidth={2.6}
                    strokeDasharray="6 4"
                    opacity={0.95}
                    strokeLinejoin="round"
                    className="attack-step-cable"
                  />
                )
              })}
            </g>

            <g className="strategy-nodes">
              {zones.flatMap((z) =>
                z.nodes.map((n) => (
                  <TokenNode
                    key={n.data.id}
                    token={nodeToken(theme, n.data.type)}
                    label={n.data.label}
                    x={n.x}
                    y={n.y}
                    showLabel
                    scale={1}
                    labelScale={labelScale}
                    selected={selectedId === n.data.id}
                    halo={nodeMatchesMode(selectMode, n.data.type, {
                      scenario: attackScenario,
                      nodeId: n.data.id,
                    }) ? theme.halos[selectMode] : null}
                    onClick={() => onSelect(n)}
                  />
                )),
              )}
            </g>
          </svg>

          {zones.filter((z) => z.openable).map((zone) => (
            <button
              key={`open-${zone.id}`}
              type="button"
              className="strategy-zone-open"
              style={{
                left: zone.rect.x + zone.rect.w - 72,
                top: zone.rect.y + 6,
              }}
              onClick={() => onOpenBoard?.(zone.id)}
              title="Open layer drill-in"
            >
              Open
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
