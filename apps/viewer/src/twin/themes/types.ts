/** Shape keys used by SVG TokenNode + Cytoscape drill-in. */
export type NodeShape =
  | 'ellipse'
  | 'round-rectangle'
  | 'rectangle'
  | 'diamond'
  | 'hexagon'
  | 'pentagon'
  | 'triangle'
  | 'vee'
  | 'tag'

export type NodeToken = {
  color: string
  border: string
  shape: NodeShape
  /** Optional icon glyph key for legends / TokenNode overlays. */
  iconKey?: string
  size: { w: number; h: number }
}

export type HaloMode = 'explore' | 'trustBoundary' | 'traffic' | 'compute' | 'attackPath'

export type CanvasTokens = {
  bg: string
  grid: string
  plane: string
  planeBorder: string
  planeShadow: string
  text: string
  muted: string
  accent: string
  panel: string
  panelBorder: string
  chrome: string
  danger: string
  warn: string
}

export type ThemeTokenSet = {
  id: string
  label: string
  description: string
  canvas: CanvasTokens
  /** TYPE_STYLE-like grammar: twin type → visual token. */
  nodes: Record<string, NodeToken>
  /** Edge kind → stroke color. */
  edges: Record<string, string>
  /** Halo colors for Select Layer modes. */
  halos: Record<HaloMode, string>
}

export type ThemeId = 'make' | 'enterprise' | 'mithril-dark' | 'polar-ops'

export const DEFAULT_NODE: NodeToken = {
  color: '#36b6e8',
  border: '#a9edff',
  shape: 'ellipse',
  size: { w: 28, h: 28 },
}
