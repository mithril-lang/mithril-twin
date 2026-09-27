import { useMemo } from 'react'
import type { AttackScenario, GraphItem, SelectMode, TwinLayer, LayerData } from '../data/types'
import { slimNodes } from '../data/boards'
import { useTheme } from '../themes/ThemeContext'
import { edgeColor, nodeToken } from '../themes/index'
import { edgeMatchesMode, nodeMatchesMode } from '../data/halo'
import TokenNode from '../components/TokenNode'
import { layoutRow } from '../components/layoutGrid'
import { orthoPath } from '../components/ortho'

const STACK: { layer: TwinLayer; label: string; sampleType: string; maxNodes: number }[] = [
  { layer: 'organization', label: 'Organization', sampleType: 'HoldingCompany', maxNodes: 6 },
  { layer: 'network', label: 'Network', sampleType: 'TransitNetwork', maxNodes: 6 },
  { layer: 'firewall', label: 'Firewall', sampleType: 'Firewall', maxNodes: 6 },
  { layer: 'node', label: 'Node', sampleType: 'NetworkDevice', maxNodes: 6 },
  { layer: 'server', label: 'Server', sampleType: 'Server', maxNodes: 6 },
]

const HEADER_W = 168
const CONTENT_W = 1120
const LANE_H = 132
const GAP = 28
const TOP = 8
const STAGE_W = HEADER_W + CONTENT_W

type Props = {
  layers: Partial<Record<TwinLayer, LayerData>>
  selectMode: SelectMode
  selectedId?: string | null
  onSelect: (item: GraphItem | null) => void
  attackScenario?: AttackScenario | null
}

function laneY(index: number) {
  return TOP + index * (LANE_H + GAP)
}

function refKeys(n: GraphItem): string[] {
  const keys = [n.data.id, n.data.org].filter((k): k is string => !!k)
  return keys
}

export default function StackedPlanes({ layers, selectMode, selectedId, onSelect, attackScenario = null }: Props) {
  const { theme } = useTheme()

  const planes = useMemo(() => {
    return STACK.map((s, index) => {
      const data = layers[s.layer]
      const rawNodes = data?.elements.nodes ?? []
      const rawEdges = data?.elements.edges ?? []
      const nodes = slimNodes(rawNodes, s.maxNodes)
      const ids = new Set(nodes.map((n) => n.data.id))
      const edges = rawEdges
        .filter((e) => ids.has(e.data.source) && ids.has(e.data.target))
        .slice(0, 24)
      const y0 = laneY(index)
      const laid = layoutRow(nodes, CONTENT_W, LANE_H, 36, 8).map((n) => ({
        ...n,
        x: n.x + HEADER_W,
        y: n.y + y0,
      }))
      const pos = new Map(laid.map((n) => [n.data.id, n]))
      return { ...s, index, total: rawNodes.length, nodes: laid, edges, pos, y0 }
    })
  }, [layers])

  const tethers = useMemo(() => {
    const links: { key: string; x1: number; y1: number; x2: number; y2: number; midY: number }[] = []
    for (let i = 0; i < planes.length - 1; i++) {
      const upper = planes[i]
      const lower = planes[i + 1]
      if (!upper || !lower) continue
      const lowerByKey = new Map<string, (typeof lower.nodes)[number]>()
      for (const n of lower.nodes) {
        for (const key of refKeys(n)) lowerByKey.set(key, n)
      }
      let count = 0
      for (const n of upper.nodes) {
        if (count >= 5) break
        const hit = refKeys(n).map((k) => lowerByKey.get(k)).find(Boolean)
        if (!hit) continue
        if (Math.abs(hit.x - n.x) < 1 && Math.abs(hit.y - n.y) < 1) continue
        links.push({
          key: `${upper.layer}-${lower.layer}-${n.data.id}-${hit.data.id}`,
          x1: n.x,
          y1: n.y + 18,
          x2: hit.x,
          y2: hit.y - 18,
          midY: upper.y0 + LANE_H + GAP / 2,
        })
        count++
      }
    }
    return links
  }, [planes])

  const stageH = TOP + STACK.length * LANE_H + (STACK.length - 1) * GAP + 12

  return (
    <div className="layer-board">
      <p className="layer-board-hint">
        Flat lanes, top to bottom. Dashed tethers mark a shared id. A readable subset is drawn; Drill-in has the full layer.
      </p>
      <div className="layer-viewport">
        <svg
          viewBox={`0 0 ${STAGE_W} ${stageH}`}
          className="layer-svg"
          role="img"
          aria-label="Flat dependency lanes"
          onClick={() => onSelect(null)}
        >
          <rect x={0} y={0} width={STAGE_W} height={stageH} fill="var(--bg-secondary, var(--tw-bg))" />
          {tethers.map((t) => (
            <path
              key={t.key}
              d={`M ${t.x1} ${t.y1} L ${t.x1} ${t.midY} L ${t.x2} ${t.midY} L ${t.x2} ${t.y2}`}
              className="lane-tether"
            />
          ))}
          {planes.map((plane) => (
            <g key={plane.layer} className="layer-lane" data-layer={plane.layer}>
              <rect
                x={8}
                y={plane.y0}
                width={STAGE_W - 16}
                height={LANE_H}
                className="lane-fill"
                rx={8}
              />
              <rect
                x={8}
                y={plane.y0}
                width={HEADER_W - 8}
                height={LANE_H}
                className="lane-header"
              />
              <TokenNode
                token={nodeToken(theme, plane.sampleType)}
                x={48}
                y={plane.y0 + 46}
                showLabel={false}
                scale={0.9}
              />
              <text x={28} y={plane.y0 + 84} className="lane-title">{plane.label}</text>
              <text x={28} y={plane.y0 + 102} className="lane-count">
                {plane.nodes.length} of {plane.total}
              </text>
              {plane.edges.map((e) => {
                const s = plane.pos.get(e.data.source)
                const t = plane.pos.get(e.data.target)
                if (!s || !t) return null
                const hot = edgeMatchesMode(selectMode, e.data.kind, {
                  scenario: attackScenario,
                  source: e.data.source,
                  target: e.data.target,
                })
                return (
                  <path
                    key={e.data.id}
                    d={orthoPath(s.x, s.y, t.x, t.y)}
                    fill="none"
                    stroke={hot ? theme.halos[selectMode] : edgeColor(theme, e.data.kind)}
                    strokeWidth={hot ? 2.4 : 1.25}
                    strokeDasharray={e.data.kind === 'guards' ? '4 3' : undefined}
                    strokeLinejoin="round"
                    opacity={0.9}
                    onClick={(ev) => { ev.stopPropagation(); onSelect(e) }}
                  />
                )
              })}
              {plane.nodes.map((n) => (
                <TokenNode
                  key={n.data.id}
                  token={nodeToken(theme, n.data.type)}
                  label={n.data.label}
                  x={n.x}
                  y={n.y}
                  scale={0.92}
                  showLabel
                  selected={selectedId === n.data.id}
                  halo={nodeMatchesMode(selectMode, n.data.type, {
                    scenario: attackScenario,
                    nodeId: n.data.id,
                  }) ? theme.halos[selectMode] : null}
                  onClick={() => onSelect(n)}
                />
              ))}
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}
