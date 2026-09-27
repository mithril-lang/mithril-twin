import { useMemo } from 'react'
import type { AttackScenario, GraphItem, SelectMode } from '../data/types'
import { edgeMatchesMode, nodeMatchesMode } from '../data/halo'
import { useTheme } from '../themes/ThemeContext'
import { edgeColor, nodeToken } from '../themes/index'
import TokenNode from './TokenNode'
import { layoutOnGrid, layoutMultipartite } from './layoutGrid'
import { orthoPath } from './ortho'

type Props = {
  title: string
  subtitle?: string
  nodes: GraphItem[]
  edges: GraphItem[]
  width?: number
  height?: number
  selectMode: SelectMode
  selectedId?: string | null
  onSelect: (item: GraphItem | null) => void
  compact?: boolean
  layout?: 'grid' | 'multi'
  className?: string
  showGrid?: boolean
  attackScenario?: AttackScenario | null
}

export default function PlaneBoard({
  title,
  subtitle,
  nodes,
  edges,
  width = 420,
  height = 280,
  selectMode,
  selectedId,
  onSelect,
  compact = false,
  layout = 'grid',
  className = '',
  showGrid = true,
  attackScenario = null,
}: Props) {
  const { theme } = useTheme()
  const laid = useMemo(
    () => (layout === 'multi' ? layoutMultipartite(nodes, width, height) : layoutOnGrid(nodes, width, height)),
    [nodes, width, height, layout],
  )
  const pos = useMemo(() => new Map(laid.map((n) => [n.data.id, n])), [laid])

  return (
    <div className={`plane-board ${compact ? 'compact' : ''} ${className}`}>
      <div className="plane-board-header">
        <div>
          <div className="plane-board-title">{title}</div>
          {subtitle && <div className="plane-board-sub">{subtitle}</div>}
        </div>
        <div className="plane-board-meta">
          {nodes.length}n · {edges.length}e
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={compact ? 200 : undefined}
        className="plane-svg"
        onClick={() => onSelect(null)}
        role="img"
        aria-label={`${title} boundary plane`}
      >
        <rect x={0} y={0} width={width} height={height} className="plane-fill" rx={10} />
        {showGrid && (
          <g className="plane-grid" stroke="var(--tw-grid)" strokeWidth={1}>
            {Array.from({ length: Math.floor(width / 28) }, (_, i) => (
              <line key={`v${i}`} x1={(i + 1) * 28} y1={0} x2={(i + 1) * 28} y2={height} />
            ))}
            {Array.from({ length: Math.floor(height / 28) }, (_, i) => (
              <line key={`h${i}`} x1={0} y1={(i + 1) * 28} x2={width} y2={(i + 1) * 28} />
            ))}
          </g>
        )}
        <g className="plane-edges">
          {edges.map((e) => {
            const s = pos.get(e.data.source)
            const t = pos.get(e.data.target)
            if (!s || !t) return null
            const col = edgeColor(theme, e.data.kind)
            const hot = edgeMatchesMode(selectMode, e.data.kind, { scenario: attackScenario, source: e.data.source, target: e.data.target })
            return (
              <g key={e.data.id}>
                {hot && (
                  <path
                    d={orthoPath(s.x, s.y, t.x, t.y)}
                    fill="none"
                    stroke={theme.halos[selectMode]}
                    strokeWidth={6}
                    opacity={0.45}
                    strokeLinejoin="round"
                  />
                )}
                <path
                  d={orthoPath(s.x, s.y, t.x, t.y)}
                  fill="none"
                  stroke={col}
                  strokeWidth={hot ? 2.2 : 1.4}
                  strokeDasharray={e.data.kind === 'guards' ? '4 3' : undefined}
                  opacity={0.85}
                  strokeLinejoin="round"
                  onClick={(ev) => { ev.stopPropagation(); onSelect(e) }}
                  style={{ cursor: 'pointer' }}
                />
              </g>
            )
          })}
        </g>
        <g className="plane-nodes">
          {laid.map((n) => (
            <TokenNode
              key={n.data.id}
              token={nodeToken(theme, n.data.type)}
              label={compact ? undefined : n.data.label}
              x={n.x}
              y={n.y}
              showLabel={!compact}
              scale={compact ? 0.75 : 1}
              selected={selectedId === n.data.id}
              halo={nodeMatchesMode(selectMode, n.data.type, { scenario: attackScenario, nodeId: n.data.id }) ? theme.halos[selectMode] : null}
              onClick={() => onSelect(n)}
            />
          ))}
        </g>
      </svg>
    </div>
  )
}
