import type {
  MithActor,
  MithBoundary,
  MithChannel,
  MithDocument,
  MithEntity,
  MithGrant,
  MithGrantLevel,
  MithRole,
} from './types'
import { analyzeExposure, DEFAULT_MAX_HOPS, isHighValueGrant, isUnverified, type RoleScore } from './exposure'
import { buildGraph, dijkstra, EDGE, NODE, type Graph } from './graph'

export { isUnverified, DEFAULT_MAX_HOPS }

/**
 * Display-only exposure analysis over the org / access / impersonation sections.
 * Pure functions over the parsed document. Nothing here contacts a system.
 */

export type OrgModel = {
  boundaries: MithBoundary[]
  roles: MithRole[]
  grants: MithGrant[]
  actors: MithActor[]
  channels: MithChannel[]
}

export function orgModel(doc: MithDocument): OrgModel {
  return {
    boundaries: doc.model.boundaries ?? [],
    roles: doc.model.roles ?? [],
    grants: doc.model.grants ?? [],
    actors: doc.model.actors ?? [],
    channels: doc.model.channels ?? [],
  }
}

/** Lenses only turn on for documents that declare org boundaries. Older files keep the layer boards. */
export function hasOrgModel(doc: MithDocument | null): boolean {
  return !!doc && (doc.model.boundaries?.length ?? 0) > 0
}

export const LEVEL_RANK: Record<MithGrantLevel, number> = { read: 1, approve: 2, admin: 3 }

/**
 * Legacy rule (no criticality declared): a grant is high-value when it can move money or change
 * access, i.e. approve or admin. See `isHighValueGrant` for the criticality-aware rule.
 */
export function isHighValue(level: MithGrantLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK.approve
}

/** Boundary ids from the root down to `id` (inclusive). */
export function boundaryPath(boundaries: MithBoundary[], id: string | undefined): MithBoundary[] {
  if (!id) return []
  const byId = new Map(boundaries.map((b) => [b.id, b]))
  const out: MithBoundary[] = []
  const seen = new Set<string>()
  let cur = byId.get(id)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.unshift(cur)
    cur = cur.parent ? byId.get(cur.parent) : undefined
  }
  return out
}

export type ReachedResource = {
  resource: string
  /** Grant level, or `network` when reached over the network without a grant (host access). */
  level: MithGrantLevel | 'network'
  /** Node ids from the impersonated role to the resource's holder role or host zone. */
  via: string[]
  /** Channel / reach ids walked (empty for a direct grant). */
  channels: string[]
  /** Total weighted cost from the impersonated role. */
  cost: number
}

export type BlastRadius = {
  role: string
  resources: ReachedResource[]
  counts: Record<MithGrantLevel, number>
  maxLevel: MithGrantLevel | null
}

/**
 * If `roleId` is impersonated, which resources are reachable and at what level.
 * Weighted reach: a Dijkstra from the role over the unified org + network graph. Everything
 * within the cost threshold counts (default `DEFAULT_BLAST_COST`, per-document
 * `model.weights.blastRadius`, or `opts.maxCost`). Weak controls count; they only add cost.
 * Resources come from grants of every role reached, plus systems hosted in reachable zones
 * (level `network`). With `lateral: false` only direct grants count.
 */
export function blastRadius(
  doc: MithDocument,
  roleId: string,
  opts: { lateral?: boolean; maxCost?: number; graph?: Graph } = {},
): BlastRadius {
  const lateral = opts.lateral ?? true
  const g = opts.graph ?? buildGraph(doc.model)
  const src = g.index.get(roleId)
  const counts: Record<MithGrantLevel, number> = { read: 0, approve: 0, admin: 0 }
  if (src == null || g.nodeType[src] !== NODE.role) return { role: roleId, resources: [], counts, maxLevel: null }
  const maxCost = opts.maxCost ?? g.weights.blastRadius
  const dj = dijkstra(g, [src])
  const pathTo = (node: number) => {
    const nodes: string[] = []
    const refs: string[] = []
    let cur = node
    while (cur !== src && dj.prevNode[cur]! >= 0) {
      nodes.unshift(g.ids[cur]!)
      const e = dj.prevEdge[cur]!
      if (g.eType[e] === EDGE.channel || g.eType[e] === EDGE.reach) refs.unshift(g.eRef[e]!)
      cur = dj.prevNode[cur]!
    }
    nodes.unshift(roleId)
    return { nodes, refs }
  }
  const within = (i: number) => dj.dist[i]! <= maxCost + 1e-9
  const rank = (l: MithGrantLevel | 'network') => (l === 'network' ? 0.5 : LEVEL_RANK[l])
  const best = new Map<string, ReachedResource>()
  const offer = (r: ReachedResource) => {
    const prev = best.get(r.resource)
    if (!prev || rank(r.level) > rank(prev.level) || (rank(r.level) === rank(prev.level) && r.cost < prev.cost)) best.set(r.resource, r)
  }
  const grants = orgModel(doc).grants
  for (const gr of grants) {
    const ri = g.index.get(gr.role)
    if (ri == null) continue
    if (!lateral && ri !== src) continue
    if (!within(ri)) continue
    const { nodes, refs } = pathTo(ri)
    offer({ resource: gr.resource, level: gr.level, via: nodes.filter((id) => g.nodeType[g.index.get(id)!] === NODE.role), channels: refs, cost: dj.dist[ri]! })
  }
  if (lateral) {
    for (let i = g.sysStart; i < g.sysEnd; i++) {
      if (!within(i)) continue
      const e = dj.prevEdge[i]!
      if (e < 0 || g.eType[e] !== EDGE.host) continue
      const { nodes, refs } = pathTo(dj.prevNode[i]!)
      offer({ resource: g.ids[i]!, level: 'network', via: nodes, channels: refs, cost: dj.dist[i]! })
    }
  }
  const resources = [...best.values()].sort(
    (a, b) => rank(b.level) - rank(a.level) || a.cost - b.cost || a.resource.localeCompare(b.resource),
  )
  for (const r of resources) if (r.level !== 'network') counts[r.level] += 1
  const top = resources.find((r) => r.level !== 'network')
  const maxLevel = (top?.level as MithGrantLevel | undefined) ?? null
  return { role: roleId, resources, counts, maxLevel }
}

export function allBlastRadii(doc: MithDocument): BlastRadius[] {
  const graph = buildGraph(doc.model)
  return orgModel(doc)
    .roles.map((r) => blastRadius(doc, r.id, { graph }))
    .sort(
      (a, b) =>
        (b.maxLevel ? LEVEL_RANK[b.maxLevel] : 0) - (a.maxLevel ? LEVEL_RANK[a.maxLevel] : 0) ||
        b.resources.length - a.resources.length ||
        a.role.localeCompare(b.role),
    )
}

export type ImpersonationPath = {
  actor: string
  target: string
  /** Node ids: actor, then each role in order. */
  nodes: string[]
  channels: string[]
  hops: number
  /** True when no hop carries a verification control. */
  unverified: boolean
}

export type RoleExposure = RoleScore

const PATH_CAP = 2000

/**
 * Every simple path from an external actor to a role over channels, up to `maxHops`.
 * Paths are sorted unverified first, then by hop count.
 */
export function impersonationPaths(
  doc: MithDocument,
  opts: { maxHops?: number; targets?: Set<string> } = {},
): ImpersonationPath[] {
  const { actors, channels, roles } = orgModel(doc)
  const maxHops = opts.maxHops ?? DEFAULT_MAX_HOPS
  const roleIds = new Set(roles.map((r) => r.id))
  const outgoing = new Map<string, MithChannel[]>()
  for (const ch of channels) {
    if (!roleIds.has(ch.to)) continue
    const list = outgoing.get(ch.from) ?? []
    list.push(ch)
    outgoing.set(ch.from, list)
  }
  const out: ImpersonationPath[] = []
  const walk = (actor: string, nodes: string[], hops: MithChannel[]) => {
    if (out.length >= PATH_CAP || hops.length >= maxHops) return
    const at = nodes[nodes.length - 1]!
    for (const ch of outgoing.get(at) ?? []) {
      if (nodes.includes(ch.to)) continue
      const nextNodes = [...nodes, ch.to]
      const nextHops = [...hops, ch]
      if (!opts.targets || opts.targets.has(ch.to)) {
        out.push({
          actor,
          target: ch.to,
          nodes: nextNodes,
          channels: nextHops.map((h) => h.id),
          hops: nextHops.length,
          unverified: nextHops.every(isUnverified),
        })
      }
      walk(actor, nextNodes, nextHops)
    }
  }
  for (const a of actors) walk(a.id, [a.id], [])
  return out.sort(
    (a, b) => Number(b.unverified) - Number(a.unverified) || a.hops - b.hops || a.nodes.join('>').localeCompare(b.nodes.join('>')),
  )
}

/**
 * Roles that hold at least one high-value grant directly: the resource is high / crown-jewel,
 * or (no criticality declared) the grant is approve / admin.
 */
export function highValueRoles(doc: MithDocument): Set<string> {
  const crit = new Map(doc.model.entities.map((e) => [e.id, e.criticality]))
  return new Set(
    orgModel(doc)
      .grants.filter((g) => isHighValueGrant(g.level, crit.get(g.resource)))
      .map((g) => g.role),
  )
}

/**
 * Per-role exposure: weighted easiest path (min cost / max ease) from any external actor,
 * exposure score (ease × criticality), plus unverified path count and min hops.
 * Sorted by score. See `exposure.ts` for the tunable weights.
 */
export function roleExposure(doc: MithDocument, opts: { maxHops?: number } = {}): RoleExposure[] {
  return analyzeExposure(doc.model, opts).roles
}

export type ShadowSystem = {
  entity: MithEntity
  source: string
  /** Boundary or person ids linked by a `uses` edge (either direction). */
  usedBy: string[]
}

/** Systems marked `sanctioned: false`, with whoever uses them. */
export function shadowSystems(doc: MithDocument): ShadowSystem[] {
  return doc.model.entities
    .filter((e) => e.sanctioned === false)
    .map((e) => {
      const usedBy = new Set<string>()
      for (const edge of doc.model.edges) {
        if (edge.kind !== 'uses') continue
        if (edge.target === e.id) usedBy.add(edge.source)
        else if (edge.source === e.id) usedBy.add(edge.target)
      }
      return { entity: e, source: e.source ?? 'unknown', usedBy: [...usedBy] }
    })
}
