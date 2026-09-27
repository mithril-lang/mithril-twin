/** Legacy layer-JSON shapes (secondary import path into .mith). */
export type TwinLayer = 'organization' | 'network' | 'firewall' | 'node' | 'server'

export type GraphItem = { data: Record<string, string> }

export type LayerData = {
  layer: TwinLayer
  dataset_kind: string
  generated_at: string
  elements: { nodes: GraphItem[]; edges: GraphItem[] }
}

export type AttackRaciCatch = {
  person_id: string
  raci: string
  process: string
}

export type AttackScenario = {
  id: string
  label: string
  summary: string
  category: string
  honesty: string
  observation_count: number
  node_ids: string[]
  edge_kinds_highlight: string[]
  raci_catch: AttackRaciCatch[]
  steps: { from: string; to: string; kind: string }[]
}

export type AttackPathsOverlay = {
  layer: 'attack-paths'
  dataset_kind: string
  generated_at: string
  disclaimer: string
  viz_only: boolean
  no_runners: boolean
  counts: { nodes: number; edges: number; scenarios: number }
  elements: { nodes: GraphItem[]; edges: GraphItem[] }
  scenarios: AttackScenario[]
}

/** Keep a readable, type-diverse subset of a large layer. */
export function slimNodes(nodes: GraphItem[], max = 28): GraphItem[] {
  if (nodes.length <= max) return nodes
  const priority = new Set([
    'HoldingCompany',
    'BankCore',
    'TrustBank',
    'TransitNetwork',
    'InternetEdge',
    'Firewall',
    'Person',
    'Role',
    'Process',
    'Vendor',
    'Payments',
    'ITDigital',
    'SharedOps',
    'Compliance',
    'Server',
    'DMZ',
  ])
  const ranked = [
    ...nodes.filter((n) => priority.has(n.data.type || '')),
    ...nodes.filter((n) => !priority.has(n.data.type || '')),
  ]
  const seen = new Set<string>()
  const diverse: GraphItem[] = []
  const rest: GraphItem[] = []
  for (const n of ranked) {
    const type = n.data.type || 'Other'
    if (!seen.has(type)) {
      seen.add(type)
      diverse.push(n)
    } else {
      rest.push(n)
    }
  }
  return [...diverse, ...rest].slice(0, max)
}
