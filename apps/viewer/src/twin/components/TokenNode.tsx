import type { NodeToken, NodeShape } from '../themes/types'
import { twinSymbol, type TwinSymbol } from '../themes/symbols'

type Props = {
  token: NodeToken
  label?: string
  x: number
  y: number
  selected?: boolean
  halo?: string | null
  onClick?: () => void
  showLabel?: boolean
  scale?: number
  /** Cancels parent zoom so type labels stay upright and readable (GRAPH). */
  labelScale?: number
}

function luminance(hex: string): number {
  const raw = hex.replace('#', '')
  if (raw.length !== 6) return 0
  const n = parseInt(raw, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

function glyphInk(fill: string): string {
  return luminance(fill) > 0.62 ? '#1a1a1a' : '#ffffff'
}

/** Upright, at most two lines. CJK names stay shorter per line. */
export function labelLines(label: string): string[] {
  const cjk = /[\u3000-\u9fff\u30a0-\u30ff\u3040-\u309f]/.test(label)
  const max = cjk ? 8 : 16
  if (label.length <= max) return [label]
  const second = label.slice(max, max * 2)
  const more = label.length > max * 2
  return [label.slice(0, max), more ? `${second.slice(0, max - 1)}…` : second]
}

function Glyph({ kind, ink }: { kind: TwinSymbol; ink: string }) {
  const stroke = ink
  const common = {
    fill: 'none' as const,
    stroke,
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (kind) {
    case 'network':
      return (
        <g {...common}>
          <circle cx={-5} cy={0} r={2.1} />
          <circle cx={5} cy={-3.2} r={2.1} />
          <circle cx={4} cy={4} r={2.1} />
          <line x1={-3} y1={0} x2={3.1} y2={-2.6} />
          <line x1={-3.1} y1={0.8} x2={2.2} y2={3.4} />
        </g>
      )
    case 'firewall':
      return (
        <g {...common}>
          <rect x={-6} y={-5} width={12} height={10} rx={0.6} />
          <line x1={-6} y1={-1.2} x2={6} y2={-1.2} />
          <line x1={-6} y1={2.6} x2={6} y2={2.6} />
          <line x1={0} y1={-5} x2={0} y2={-1.2} />
          <line x1={-3} y1={-1.2} x2={-3} y2={2.6} />
          <line x1={3} y1={2.6} x2={3} y2={5} />
        </g>
      )
    case 'server':
      return (
        <g {...common}>
          <rect x={-7} y={-6} width={14} height={12} rx={1} />
          <line x1={-7} y1={-1.2} x2={7} y2={-1.2} />
          <line x1={-7} y1={3.2} x2={7} y2={3.2} />
          <circle cx={4.2} cy={-3.6} r={0.9} fill={ink} stroke="none" />
          <circle cx={4.2} cy={1} r={0.9} fill={ink} stroke="none" />
        </g>
      )
    case 'node':
      return (
        <g {...common}>
          <circle cx={0} cy={0} r={5} />
          <circle cx={0} cy={0} r={1.5} fill={ink} stroke="none" />
        </g>
      )
    case 'person':
      return (
        <g {...common}>
          <circle cx={0} cy={-3.2} r={2.3} />
          <path d="M -5.2 5.2 Q 0 0.6 5.2 5.2" />
        </g>
      )
    case 'process':
      return (
        <g {...common}>
          <path d="M -5 0 L 0 -4.5 L 5 0 L 0 4.5 Z" />
        </g>
      )
    case 'alert':
      return (
        <g {...common}>
          <path d="M 0 -5.5 L 5.2 4.2 L -5.2 4.2 Z" />
          <line x1={0} y1={-1.6} x2={0} y2={1.4} />
        </g>
      )
    default:
      return (
        <g {...common}>
          <rect x={-6} y={-5.2} width={12} height={10.2} rx={0.8} />
          <line x1={-3.2} y1={-2.2} x2={-3.2} y2={-0.2} />
          <line x1={0} y1={-2.2} x2={0} y2={-0.2} />
          <line x1={3.2} y1={-2.2} x2={3.2} y2={-0.2} />
          <rect x={-1.6} y={1.6} width={3.2} height={3.4} />
        </g>
      )
  }
}

function ShapePath({ shape, w, h, color, border }: {
  shape: NodeShape
  w: number
  h: number
  color: string
  border: string
}) {
  const common = { fill: color, stroke: border, strokeWidth: 1.5 }
  switch (shape) {
    case 'ellipse':
      return <ellipse cx={0} cy={0} rx={w / 2} ry={h / 2} {...common} />
    case 'rectangle':
      return <rect x={-w / 2} y={-h / 2} width={w} height={h} {...common} />
    case 'round-rectangle':
      return <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={5} ry={5} {...common} />
    case 'diamond':
      return <polygon points={`0,${-h / 2} ${w / 2},0 0,${h / 2} ${-w / 2},0`} {...common} />
    case 'triangle':
      return <polygon points={`0,${-h / 2} ${w / 2},${h / 2} ${-w / 2},${h / 2}`} {...common} />
    case 'vee':
      return <polygon points={`0,${-h / 2} ${w / 2},${h / 2} 0,${h / 4} ${-w / 2},${h / 2}`} {...common} />
    case 'hexagon': {
      const r = Math.min(w, h) / 2
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 6
        return `${r * Math.cos(a)},${r * Math.sin(a)}`
      }).join(' ')
      return <polygon points={pts} {...common} />
    }
    case 'pentagon': {
      const r = Math.min(w, h) / 2
      const pts = Array.from({ length: 5 }, (_, i) => {
        const a = ((Math.PI * 2) / 5) * i - Math.PI / 2
        return `${r * Math.cos(a)},${r * Math.sin(a)}`
      }).join(' ')
      return <polygon points={pts} {...common} />
    }
    case 'tag':
      return (
        <path
          d={`M ${-w / 2} ${-h / 2} H ${w / 2 - 8} L ${w / 2} 0 L ${w / 2 - 8} ${h / 2} H ${-w / 2} Z`}
          {...common}
        />
      )
    default:
      return <ellipse cx={0} cy={0} rx={w / 2} ry={h / 2} {...common} />
  }
}

export default function TokenNode({
  token, label, x, y, selected, halo, onClick, showLabel = true, scale = 1, labelScale = 1,
}: Props) {
  const { w, h } = token.size
  const kind = twinSymbol(token.iconKey)
  const ink = glyphInk(token.color)
  const lines = label ? labelLines(label) : []
  const safeLabelScale = labelScale > 0 ? labelScale : 1
  const labelTop = (h / 2 + 14) / safeLabelScale

  return (
    <g
      transform={`translate(${x},${y}) scale(${scale})`}
      className={`token-node${selected ? ' is-selected' : ''}`}
      data-symbol={kind}
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      {halo && (
        <rect
          x={-w / 2 - 8}
          y={-h / 2 - 8}
          width={w + 16}
          height={h + 16}
          rx={8}
          fill={halo}
          className="token-halo"
        />
      )}
      <ShapePath
        shape={token.shape}
        w={w}
        h={h}
        color={token.color}
        border={selected ? 'var(--accent, #003f7a)' : token.border}
      />
      <Glyph kind={kind} ink={ink} />
      {selected && (
        <rect
          x={-w / 2 - 5}
          y={-h / 2 - 5}
          width={w + 10}
          height={h + 10}
          rx={7}
          fill="none"
          stroke="var(--accent, #003f7a)"
          strokeWidth={2}
          className="token-select-ring"
        />
      )}
      {showLabel && lines.length > 0 && (
        <g transform={`scale(${safeLabelScale})`} className="token-label-wrap">
          <text y={labelTop} textAnchor="middle" className="token-label">
            {lines.map((line, i) => (
              <tspan key={i} x={0} dy={i === 0 ? 0 : 13}>
                {line}
              </tspan>
            ))}
          </text>
        </g>
      )}
    </g>
  )
}
