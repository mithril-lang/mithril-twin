import type { AttackScenario, GraphItem, SelectMode } from '../data/types'
import StrategyCanvas from '../components/StrategyCanvas'

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

/**
 * Secondary view: one flat orthogonal board.
 * The default overview is the isometric Make grid.
 */
export default function GridOverview({
  orgNodes, orgEdges, selectMode, selectedId, onSelect, onOpenBoard,
  attackScenario, attackOverlayNodes, attackOverlayEdges,
}: Props) {
  return (
    <StrategyCanvas
      orgNodes={orgNodes}
      orgEdges={orgEdges}
      selectMode={selectMode}
      selectedId={selectedId}
      onSelect={onSelect}
      onOpenBoard={onOpenBoard}
      attackScenario={attackScenario}
      attackOverlayNodes={attackOverlayNodes}
      attackOverlayEdges={attackOverlayEdges}
    />
  )
}
