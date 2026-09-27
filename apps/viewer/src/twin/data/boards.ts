import type { BoundaryBoard, GraphItem } from './types'

/** Org types grouped into flat overview zones. */
export const BOUNDARY_BOARDS: BoundaryBoard[] = [
  {
    id: 'holding',
    label: 'Holding',
    subtitle: 'Group HQ & anchors',
    orgTypes: ['HoldingCompany', 'OrgAnchor', 'Role'],
  },
  {
    id: 'bank-core',
    label: 'BankCore cluster',
    subtitle: 'Bank · Trust · Markets · Payments',
    orgTypes: [
      'BankCore',
      'TrustBank',
      'Securities',
      'AssetMgmt',
      'Card',
      'Payments',
      'Custody',
      'MarketInfra',
      'Insurance',
      'Process',
      'Person',
    ],
  },
  {
    id: 'it-digital',
    label: 'ITDigital',
    subtitle: 'IT · Data/AI · SharedOps · Compliance',
    orgTypes: ['ITDigital', 'DataAI', 'SharedOps', 'Compliance', 'Research', 'Person', 'Process', 'Vendor'],
  },
  {
    id: 'regional',
    label: 'Regional',
    subtitle: 'Regional · Overseas · Affiliates',
    orgTypes: [
      'Regional',
      'OverseasDesk',
      'Leasing',
      'RealEstate',
      'Venture',
      'Other',
    ],
  },
]

export function boardForOrgType(type: string): BoundaryBoard | undefined {
  return BOUNDARY_BOARDS.find((b) => b.orgTypes.includes(type))
}

/** Subgraph: nodes whose type is in board.orgTypes + edges with both ends present. */
export function subsetForBoard(
  nodes: GraphItem[],
  edges: GraphItem[],
  board: BoundaryBoard,
  /** Always include HoldingCompany so boards can show a tether to HQ. */
  includeHolding = true,
): { nodes: GraphItem[]; edges: GraphItem[] } {
  const allow = new Set(board.orgTypes)
  if (includeHolding && board.id !== 'holding') allow.add('HoldingCompany')
  const subsetNodes = nodes.filter((n) => allow.has(n.data.type || ''))
  const ids = new Set(subsetNodes.map((n) => n.data.id))
  const subsetEdges = edges.filter(
    (e) => ids.has(e.data.source) && ids.has(e.data.target),
  )
  return { nodes: subsetNodes, edges: subsetEdges }
}

/** Cap nodes for overview boards. Hubs first, one of each type, then a hard max. */
export { slimNodes } from '@mithril-twin/mith'
