import type { AttackScenario, SelectMode } from './types'

const TRUST_TYPES = new Set(['Firewall', 'Compliance', 'InternetEdge', 'DMZ'])
const TRUST_KINDS = new Set(['guards'])
const TRAFFIC_KINDS = new Set(['uplinksTo', 'peersWith', 'talksTo', 'usesNetwork', 'extends'])
const COMPUTE_TYPES = new Set([
  'Server',
  'CloudRole',
  'Workstation',
  'NetworkDevice',
  'ATMOrBranchDevice',
  'MobileManaged',
  'Cluster',
])
const ATTACK_NODE_TYPES = new Set([
  'AttackPath',
  'Technique',
  'EntryPoint',
  'Process',
  'Person',
  'Role',
  'Vendor',
])
const ATTACK_EDGE_KINDS = new Set([
  'pathStep',
  'targets',
  'usesTechnique',
  'lateralTo',
  'includesStep',
  'sharedVendor',
])

/** Whether a node should receive a mode halo. */
export function nodeMatchesMode(
  mode: SelectMode,
  type: string | undefined,
  opts?: { scenario?: AttackScenario | null; nodeId?: string },
): boolean {
  if (mode === 'explore') return false
  if (mode === 'trustBoundary') return TRUST_TYPES.has(type || '')
  if (mode === 'compute') return COMPUTE_TYPES.has(type || '')
  if (mode === 'traffic') return false
  if (mode === 'attackPath') {
    const sc = opts?.scenario
    if (sc && opts?.nodeId) {
      if (sc.node_ids.includes(opts.nodeId)) return true
      if (sc.raci_catch.some((r) => r.person_id === opts.nodeId)) return true
      return false
    }
    return ATTACK_NODE_TYPES.has(type || '')
  }
  return false
}

export function edgeMatchesMode(
  mode: SelectMode,
  kind: string | undefined,
  opts?: { scenario?: AttackScenario | null; source?: string; target?: string },
): boolean {
  if (mode === 'explore') return false
  if (mode === 'trustBoundary') return TRUST_KINDS.has(kind || '')
  if (mode === 'traffic') return TRAFFIC_KINDS.has(kind || '')
  if (mode === 'compute') return kind === 'hostedOn' || kind === 'operates' || kind === 'aggregates'
  if (mode === 'attackPath') {
    const sc = opts?.scenario
    if (sc && opts?.source && opts?.target) {
      const onStep = sc.steps.some(
        (s) =>
          (s.from === opts.source && s.to === opts.target) ||
          (s.from === opts.target && s.to === opts.source),
      )
      if (onStep) return true
      if (
        sc.edge_kinds_highlight.includes(kind || '') &&
        sc.node_ids.includes(opts.source) &&
        sc.node_ids.includes(opts.target)
      ) {
        return true
      }
      return false
    }
    return ATTACK_EDGE_KINDS.has(kind || '')
  }
  return false
}

export const SELECT_MODES: { id: SelectMode; label: string; hint: string }[] = [
  { id: 'explore', label: 'Explore', hint: 'Structure overview' },
  { id: 'trustBoundary', label: 'TrustBoundary', hint: 'FW / guards halo' },
  { id: 'traffic', label: 'Traffic', hint: 'Uplinks / request paths' },
  { id: 'compute', label: 'Compute', hint: 'Node / server focus' },
  {
    id: 'attackPath',
    label: 'AttackPath',
    hint: 'Hypothesis fraud/BEC path overlay (viz only — no runners)',
  },
]
