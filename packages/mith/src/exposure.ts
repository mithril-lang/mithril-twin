import {
  buildGraph,
  channelCost,
  DEFAULT_CONTROL_WEIGHTS,
  dijkstra,
  EDGE,
  NODE,
  reconstruct,
  resolveWeights,
  type EdgeType,
  type Graph,
  type MixedHop,
} from './graph'
import type { MithChannel, MithCriticality, MithDocument, MithGrantLevel, MithVerification } from './types'

/**
 * Weighted org + network attack-graph exposure. Display-only arithmetic over the parsed document.
 * The unified graph lives in `graph.ts`; this module scores and ranks it.
 *
 * A role's exposure combines the ease of seizing the role (1 / cheapest actor→role cost) with the
 * value of what it can reach — direct grants AND systems reachable across the network from the
 * role's device zone. Resources are scored by the cheapest actor→system path, org or network.
 *
 * Weights are tunable ranking defaults, overridable per document. They are NOT claims about
 * real-world bypass success rates.
 */

export { BASE_HOP_COST, DEFAULT_CONTROL_WEIGHTS as CONTROL_WEIGHTS, resolveWeights } from './graph'
export type { MixedHop } from './graph'

export const CRITICALITY_WEIGHT: Record<MithCriticality, number> = {
  low: 1,
  medium: 2,
  high: 4,
  'crown-jewel': 8,
}

export const LEVEL_FACTOR: Record<MithGrantLevel, number> = { read: 0.4, approve: 0.8, admin: 1 }
/** Value factor for a system reached over the network without any grant (host access). */
export const NETWORK_FACTOR = 0.6

const MAX_VALUE = CRITICALITY_WEIGHT['crown-jewel'] * LEVEL_FACTOR.admin

export const DEFAULT_MAX_HOPS = 4
/** Upper bound on DFS steps when counting simple channel paths. Counts are marked `capped` past it. */
export const DEFAULT_VISIT_CAP = 3_000_000

/** A channel hop is unverified when it lists no control other than `none`. */
export function isUnverified(channel: Pick<MithChannel, 'verification'>): boolean {
  return channel.verification.every((v) => v === 'none')
}

/** Channel hop cost with the default weights (kept for callers that don't hold a document). */
export function hopCost(channel: Pick<MithChannel, 'verification'>): number {
  return channelCost(channel, resolveWeights())
}

export function effectiveCriticality(level: MithGrantLevel, criticality?: MithCriticality): MithCriticality {
  if (criticality) return criticality
  return level === 'read' ? 'medium' : 'high'
}

export function isHighValueGrant(level: MithGrantLevel, criticality?: MithCriticality): boolean {
  if (criticality) return CRITICALITY_WEIGHT[criticality] >= CRITICALITY_WEIGHT.high
  return level !== 'read'
}

export function grantValue(level: MithGrantLevel, criticality?: MithCriticality): number {
  return CRITICALITY_WEIGHT[effectiveCriticality(level, criticality)] * LEVEL_FACTOR[level]
}

export type EasiestPath = { actor: string; nodes: string[]; channels: string[]; cost: number; hops?: MixedHop[] }

export type RoleScore = {
  role: string
  highValue: boolean
  value: number
  topResource: string | null
  minCost: number | null
  ease: number
  score: number
  easiest: EasiestPath | null
  paths: number
  unverifiedPaths: number
  minHops: number | null
  minUnverifiedHops: number | null
  /** True when the role's best value comes from a network-reachable system it holds no grant on. */
  viaNetwork: boolean
}

export type ResourceScore = {
  resource: string
  criticality: MithCriticality
  declared: boolean
  score: number
  ease: number
  viaRole: string | null
  level: MithGrantLevel | null
  grants: number
  /** True when the cheapest path reaches this system over the network (host edge), not a grant. */
  viaNetwork: boolean
  cost: number | null
}

/** A system an impersonated identity can reach across the network although its role has no grant. */
export type NetworkExposure = {
  resource: string
  criticality: MithCriticality
  score: number
  cost: number
  viaRole: string | null
  fromZone: string | null
  hostZone: string | null
}

/** A shadow-IT SaaS that opens a path from outside into internal zones. */
export type ShadowEntry = {
  system: string
  zone: string | null
  reachableZones: number
  reachesCrownJewelZone: boolean
  usedBy: number
}

export type ExposureReport = {
  roles: RoleScore[]
  resources: ResourceScore[]
  networkExposures: NetworkExposure[]
  shadowEntries: ShadowEntry[]
  totals: {
    actors: number
    roles: number
    channels: number
    zones: number
    reachEdges: number
    paths: number
    unverifiedPaths: number
    reachableRoles: number
    reachableSystems: number
    networkOnlySystems: number
    capped: boolean
    maxHops: number
  }
}

type Input = MithDocument['model']

/** Weighted exposure across the org + network graph, plus channel-only path counts. */
export function analyzeExposure(
  model: Input,
  opts: { maxHops?: number; visitCap?: number } = {},
): ExposureReport {
  const maxHops = opts.maxHops ?? DEFAULT_MAX_HOPS
  const visitCap = opts.visitCap ?? DEFAULT_VISIT_CAP
  const roles = model.roles ?? []
  const actors = model.actors ?? []
  const grants = model.grants ?? []
  const channels = model.channels ?? []

  const g = buildGraph(model)
  const dj = dijkstra(g, Array.from({ length: g.nA }, (_, i) => i))
  const { dist } = dj

  const crit = new Map<string, MithCriticality | undefined>()
  for (const e of model.entities) crit.set(e.id, e.criticality)
  const scoreOf = (ease: number, value: number) => Math.round((1000 * ease * value) / MAX_VALUE) / 10
  const easeOf = (i: number) => (Number.isFinite(dist[i]!) && dist[i]! > 0 ? 1 / dist[i]! : 0)

  // ---- Channel-only metrics (impersonation semantics): paths, unverified, min hops ----
  const nA = g.nA
  const roleIndex = new Map<string, number>()
  roles.forEach((r, k) => roleIndex.set(r.id, k))
  const cn = nA + roles.length
  const cid = (id: string): number => {
    const a = actors.findIndex((x) => x.id === id)
    if (a >= 0) return a
    const r = roleIndex.get(id)
    return r == null ? -1 : nA + r
  }
  const cDeg = new Int32Array(cn + 1)
  const usable = channels.filter((c) => cid(c.from) >= 0 && (roleIndex.get(c.to) ?? -1) >= 0)
  for (const c of usable) cDeg[cid(c.from) + 1]! += 1
  for (let i = 0; i < cn; i++) cDeg[i + 1]! += cDeg[i]!
  const cFill = cDeg.slice(0, cn)
  const cTo = new Int32Array(usable.length)
  const cUnv = new Uint8Array(usable.length)
  for (const c of usable) {
    const at = cFill[cid(c.from)]!++
    cTo[at] = nA + roleIndex.get(c.to)!
    cUnv[at] = isUnverified(c) ? 1 : 0
  }
  const bfs = (unverifiedOnly: boolean) => {
    const hops = new Int32Array(cn).fill(-1)
    const q = new Int32Array(cn)
    let head = 0, tail = 0
    for (let a = 0; a < nA; a++) { hops[a] = 0; q[tail++] = a }
    while (head < tail) {
      const u = q[head++]!
      for (let e = cDeg[u]!; e < cDeg[u + 1]!; e++) {
        if (unverifiedOnly && !cUnv[e]) continue
        const v = cTo[e]!
        if (hops[v] !== -1) continue
        hops[v] = hops[u]! + 1
        q[tail++] = v
      }
    }
    return hops
  }
  const minHops = bfs(false)
  const minUnv = bfs(true)
  const pathCount = new Float64Array(cn)
  const unvCount = new Float64Array(cn)
  const onPath = new Uint8Array(cn)
  let visits = 0
  let capped = false
  const sNode = new Int32Array(maxHops + 1)
  const sEdge = new Int32Array(maxHops + 1)
  const sUnv = new Uint8Array(maxHops + 1)
  for (let a = 0; a < nA && !capped; a++) {
    let sp = 0
    sNode[0] = a; sEdge[0] = cDeg[a]!; sUnv[0] = 1; onPath[a] = 1
    while (sp >= 0) {
      const u = sNode[sp]!
      const e = sEdge[sp]!
      if (e >= cDeg[u + 1]! || sp >= maxHops) { onPath[u] = 0; sp--; continue }
      sEdge[sp] = e + 1
      const v = cTo[e]!
      if (onPath[v]) continue
      if (++visits > visitCap) { capped = true; break }
      const unv = sUnv[sp]! && cUnv[e]! ? 1 : 0
      pathCount[v]! += 1
      if (unv) unvCount[v]! += 1
      sp++
      sNode[sp] = v; sEdge[sp] = cDeg[v]!; sUnv[sp] = unv; onPath[v] = 1
    }
    onPath.fill(0)
  }

  const grantsByResource = new Map<string, NonNullable<Input['grants']>>()
  for (const gr of grants) {
    const list = grantsByResource.get(gr.resource) ?? []
    list.push(gr)
    grantsByResource.set(gr.resource, list)
  }

  // ---- Direct grant value per role (org dimension) ----
  const roleGrantValue = new Map<string, { value: number; resource: string; network: boolean }>()
  const grantsByRole = new Map<string, Set<string>>()
  for (const gr of grants) {
    const c = crit.get(gr.resource)
    const v = grantValue(gr.level, c)
    const prev = roleGrantValue.get(gr.role)
    if (!prev || v > prev.value) roleGrantValue.set(gr.role, { value: v, resource: gr.resource, network: false })
    const set = grantsByRole.get(gr.role) ?? new Set()
    set.add(gr.resource)
    grantsByRole.set(gr.role, set)
  }

  // ---- Resource scores: cheapest actor→system path, org or network ----
  // Identify, per system node, which role sits earliest on the cheapest path and the final edge.
  // Role nearest the system on its cheapest path: the grant holder, or the role whose device pivoted.
  const firstRoleOnPath = (sysNode: number): number => {
    let cur = sysNode
    while (dj.prevNode[cur]! >= 0) {
      const p = dj.prevNode[cur]!
      if (g.nodeType[p] === NODE.role) return p
      cur = p
    }
    return -1
  }
  const finalEdgeType = (sysNode: number): EdgeType | -1 => {
    const e = dj.prevEdge[sysNode]!
    return e >= 0 ? (g.eType[e]! as EdgeType) : -1
  }

  const resources: ResourceScore[] = []
  const networkExposures: NetworkExposure[] = []
  let reachableSystems = 0
  let networkOnlySystems = 0
  for (let i = g.sysStart; i < g.sysEnd; i++) {
    const id = g.ids[i]!
    const d = dist[i]!
    const c = crit.get(id)
    const reachable = Number.isFinite(d)
    if (reachable) reachableSystems++
    const finalT = finalEdgeType(i)
    const viaNetwork = finalT === EDGE.host
    const roleNode = reachable ? firstRoleOnPath(i) : -1
    const viaRole = roleNode >= 0 ? g.ids[roleNode]! : null
    // Value: a grant path uses the best grant level; a network (host) path uses NETWORK_FACTOR.
    const rg = grantsByResource.get(id) ?? []
    let level: MithGrantLevel | null = null
    for (const gr of rg) if (level == null || LEVEL_FACTOR[gr.level] > LEVEL_FACTOR[level]) level = gr.level
    const factor = viaNetwork || level == null ? NETWORK_FACTOR : LEVEL_FACTOR[level]
    const declaredCrit = c ?? effectiveCriticality(level ?? 'read')
    const grantCount = rg.length
    if (viaNetwork) level = null
    const value = CRITICALITY_WEIGHT[declaredCrit] * factor
    const ease = easeOf(i)
    resources.push({
      resource: id,
      criticality: declaredCrit,
      declared: !!c,
      score: scoreOf(ease, value),
      ease,
      viaRole,
      level,
      grants: grantCount,
      viaNetwork,
      cost: reachable ? d : null,
    })
    // Network-reachable without grant: reached via host edge and the entry role has no grant on it.
    const roleHasGrant = viaRole ? grantsByRole.get(viaRole)?.has(id) : false
    if (reachable && viaNetwork && !roleHasGrant) {
      networkOnlySystems++
      const hostEdge = dj.prevEdge[i]!
      const hostZoneNode = hostEdge >= 0 ? dj.prevNode[i]! : -1
      networkExposures.push({
        resource: id,
        criticality: declaredCrit,
        score: scoreOf(ease, CRITICALITY_WEIGHT[declaredCrit] * NETWORK_FACTOR),
        cost: d,
        viaRole,
        fromZone: roleNode >= 0 && g.roleZone.get(viaRole!)?.[0] ? g.roleZone.get(viaRole!)![0]! : null,
        hostZone: hostZoneNode >= 0 ? g.ids[hostZoneNode]! : null,
      })
    }
  }
  resources.sort(
    (a, b) => b.score - a.score || CRITICALITY_WEIGHT[b.criticality] - CRITICALITY_WEIGHT[a.criticality] || a.resource.localeCompare(b.resource),
  )
  networkExposures.sort((a, b) => b.score - a.score || a.cost - b.cost || a.resource.localeCompare(b.resource))

  // ---- Role scores: ease(role) × best reachable value (grant or network) ----
  // Best value reachable by seizing each role: its grants, plus systems reachable from its zones.
  // Zone→system reachability closure gives the best criticality reachable from each zone.
  const zoneBestCrit = zoneReachableCriticality(g, crit)
  const roleScores: RoleScore[] = roles.map((r) => {
    const i = g.index.get(r.id)!
    const ease = easeOf(i)
    const direct = roleGrantValue.get(r.id)
    let value = direct?.value ?? 0
    let topResource = direct?.resource ?? null
    let viaNet = false
    for (const z of g.roleZone.get(r.id) ?? []) {
      const best = zoneBestCrit.get(z)
      if (best && CRITICALITY_WEIGHT[best.crit] * NETWORK_FACTOR > value) {
        value = CRITICALITY_WEIGHT[best.crit] * NETWORK_FACTOR
        topResource = best.system
        viaNet = true
      }
    }
    const high = [...(grantsByRole.get(r.id) ?? [])].some((res) => isHighValueGrant(bestLevel(grants, r.id, res), crit.get(res)))
    return {
      role: r.id,
      highValue: high,
      value,
      topResource,
      minCost: Number.isFinite(dist[i]!) ? dist[i]! : null,
      ease,
      score: scoreOf(ease, value),
      easiest: easiestFor(g, dj, i),
      paths: pathCount[nA + roleIndex.get(r.id)!]!,
      unverifiedPaths: unvCount[nA + roleIndex.get(r.id)!]!,
      minHops: minHops[nA + roleIndex.get(r.id)!]! >= 0 ? minHops[nA + roleIndex.get(r.id)!]! : null,
      minUnverifiedHops: minUnv[nA + roleIndex.get(r.id)!]! >= 0 ? minUnv[nA + roleIndex.get(r.id)!]! : null,
      viaNetwork: viaNet,
    }
  })
  roleScores.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.highValue) - Number(a.highValue) ||
      b.unverifiedPaths - a.unverifiedPaths ||
      (a.minHops ?? 99) - (b.minHops ?? 99) ||
      a.role.localeCompare(b.role),
  )

  // ---- Shadow-IT SaaS entry paths into zones ----
  const shadowEntries = shadowSaaSEntries(g, model, crit)

  let paths = 0, unverifiedPaths = 0, reachableRoles = 0
  for (const r of roleScores) {
    paths += r.paths
    unverifiedPaths += r.unverifiedPaths
    if (r.minCost != null) reachableRoles++
  }
  return {
    roles: roleScores,
    resources,
    networkExposures,
    shadowEntries,
    totals: {
      actors: nA,
      roles: roles.length,
      channels: usable.length,
      zones: g.zoneEnd - g.zoneStart,
      reachEdges: (model.reach ?? []).length,
      paths,
      unverifiedPaths,
      reachableRoles,
      reachableSystems,
      networkOnlySystems,
      capped,
      maxHops,
    },
  }
}

function bestLevel(grants: NonNullable<Input['grants']>, role: string, resource: string): MithGrantLevel {
  let best: MithGrantLevel = 'read'
  for (const g of grants) if (g.role === role && g.resource === resource && LEVEL_FACTOR[g.level] > LEVEL_FACTOR[best]) best = g.level
  return best
}

function easiestFor(g: Graph, dj: ReturnType<typeof dijkstra>, roleNode: number): EasiestPath | null {
  if (!Number.isFinite(dj.dist[roleNode]!)) return null
  const hops = reconstruct(g, dj, roleNode)
  const nodes = hops.length ? [hops[0]!.from, ...hops.map((h) => h.to)] : [g.ids[roleNode]!]
  return {
    actor: nodes[0]!,
    nodes,
    channels: hops.filter((h) => h.edge === EDGE.channel).map((h) => h.ref),
    cost: dj.dist[roleNode]!,
    hops,
  }
}

/** For each zone, the highest criticality of any system hosted in a zone reachable over finite reach. */
function zoneReachableCriticality(
  g: Graph,
  crit: Map<string, MithCriticality | undefined>,
): Map<string, { crit: MithCriticality; system: string }> {
  // Reach adjacency over zones only.
  const zoneNodes: number[] = []
  for (let i = g.zoneStart; i < g.zoneEnd; i++) zoneNodes.push(i)
  // Systems hosted directly in each zone (host edges from zone → system).
  const hostedBest = new Map<number, { crit: MithCriticality; system: string }>()
  for (const z of zoneNodes) {
    for (let e = g.deg[z]!; e < g.deg[z + 1]!; e++) {
      if (g.eType[e] !== EDGE.host) continue
      const sys = g.eTo[e]!
      const c = crit.get(g.ids[sys]!)
      const eff = c ?? 'medium'
      const prev = hostedBest.get(z)
      if (!prev || CRITICALITY_WEIGHT[eff] > CRITICALITY_WEIGHT[prev.crit]) hostedBest.set(z, { crit: eff, system: g.ids[sys]! })
    }
  }
  // Closure: best reachable = max over zones reachable via finite reach edges (incl. self).
  const out = new Map<string, { crit: MithCriticality; system: string }>()
  for (const start of zoneNodes) {
    let best = hostedBest.get(start) ?? null
    const seen = new Set<number>([start])
    const stack = [start]
    while (stack.length) {
      const z = stack.pop()!
      const here = hostedBest.get(z)
      if (here && (!best || CRITICALITY_WEIGHT[here.crit] > CRITICALITY_WEIGHT[best.crit])) best = here
      for (let e = g.deg[z]!; e < g.deg[z + 1]!; e++) {
        if (g.eType[e] !== EDGE.reach) continue
        const t = g.eTo[e]!
        if (!seen.has(t)) { seen.add(t); stack.push(t) }
      }
    }
    if (best) out.set(g.ids[start]!, best)
  }
  return out
}

function shadowSaaSEntries(
  g: Graph,
  model: Input,
  _crit: Map<string, MithCriticality | undefined>,
): ShadowEntry[] {
  const usesCount = new Map<string, number>()
  for (const e of model.edges) if (e.kind === 'uses') usesCount.set(e.target, (usesCount.get(e.target) ?? 0) + 1)
  const hostedCrit = new Map<string, MithCriticality>()
  for (const e of model.entities) {
    if (e.layer === 'server' && e.zone) {
      const c = e.criticality ?? 'medium'
      const prev = hostedCrit.get(e.zone)
      if (!prev || CRITICALITY_WEIGHT[c] > CRITICALITY_WEIGHT[prev]) hostedCrit.set(e.zone, c)
    }
  }
  const out: ShadowEntry[] = []
  for (const e of model.entities) {
    if (e.sanctioned !== false) continue
    const zoneNode = e.zone ? g.index.get(e.zone) : undefined
    let reachableZones = 0
    let crownJewel = false
    if (zoneNode != null) {
      const seen = new Set<number>([zoneNode])
      const stack = [zoneNode]
      while (stack.length) {
        const z = stack.pop()!
        for (let ed = g.deg[z]!; ed < g.deg[z + 1]!; ed++) {
          if (g.eType[ed] !== EDGE.reach) continue
          const t = g.eTo[ed]!
          if (seen.has(t)) continue
          seen.add(t)
          reachableZones++
          const hz = hostedCrit.get(g.ids[t]!)
          if (hz === 'crown-jewel') crownJewel = true
          stack.push(t)
        }
      }
    }
    out.push({
      system: e.id,
      zone: e.zone ?? null,
      reachableZones,
      reachesCrownJewelZone: crownJewel,
      usedBy: usesCount.get(e.id) ?? 0,
    })
  }
  out.sort(
    (a, b) => Number(b.reachesCrownJewelZone) - Number(a.reachesCrownJewelZone) || b.reachableZones - a.reachableZones || b.usedBy - a.usedBy || a.system.localeCompare(b.system),
  )
  return out
}

// Kept for callers importing the constant list of controls.
export { DEFAULT_CONTROL_WEIGHTS }
export type { MithVerification }
