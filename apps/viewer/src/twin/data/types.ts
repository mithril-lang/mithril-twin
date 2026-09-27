export type { TwinLayer, GraphItem, LayerData, AttackRaciCatch, AttackScenario, AttackPathsOverlay } from '@mithril-twin/mith'

/** make = isometric grid (default). board = flat orthogonal enterprise view. drill = one layer. */
export type ViewMode = 'make' | 'board' | 'drill'

export type SelectMode = 'explore' | 'trustBoundary' | 'traffic' | 'compute' | 'attackPath'

export type BoundaryBoardId = 'holding' | 'bank-core' | 'it-digital' | 'regional'

export type BoundaryBoard = {
  id: BoundaryBoardId
  label: string
  subtitle: string
  /** Org types that belong on this board. */
  orgTypes: string[]
}

/** Viz-only attack scenario overlay (no runners). */
