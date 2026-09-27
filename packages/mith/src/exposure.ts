import {
  buildGraph,
  channelCost,
  DEFAULT_CONTROL_WEIGHTS,
  DEFAULT_NETWORK_VALUE,
  dijkstra,
  EDGE,
  MinHeap,
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
export const NETWORK_FACTOR = DEFAULT_NETWORK_VALUE

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
  /** Network cost from the seized role to `topResource` (0 for a direct grant). */
  topCost: number
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
  /** Internal zones the SaaS syncs into (from the departments / people that use it). */
  syncZones: number
  reachableZones: number
  reachesCrownJewelZone: boolean
  /** Cheapest cost from the SaaS to a crown-jewel system over sync + reach + host; null if none. */
  crownJewelCost: number | null
  crownJewel: string | null
  usedBy: number
}

/** Per-zone network posture: what a foothold in this zone reaches. */
export type ZoneScore = {
  zone: string
  hostsCrownJewel: boolean
  /** A path of only `open` reach edges (≥ 1 hop) ends in a zone hosting a crown jewel. */
  openToCrownJewel: boolean
  /** Cheapest weighted cost from the zone to any crown-jewel system (blocked impassable). */
  crownJewelCost: number | null
  crownJewel: string | null
  reachableZones: number
}

export type ExposureReport = {
  roles: RoleScore[]
  resources: ResourceScore[]
  networkExposures: NetworkExposure[]
  shadowEntries: ShadowEntry[]
  zones: ZoneScore[]
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
    openToCrownJewelZones: number
    /** Shadow SaaS whose cheapest path to a crown jewel costs ≤ the blast-radius threshold. */
    shadowToCrownJewel: number
    capped: boolean
    maxHops: number
  }
}

type Input = MithDocument['model']

/** Weighted exposure across the org + network graph, plus channel-only path counts. */
export function analyzeExposure(model: Input, opts: { maxHops?: number; visitCap?: number } = {}): ExposureReport {
  return analyzeExposureGraph(model, opts).report
}

/** Same as `analyzeExposure`, also returning the graph and actor Dijkstra for on-demand paths. */
export function analyzeExposureGraph(
  model: Input,
  opts: { maxHops?: number; visitCap?: number } = {},
): { report: ExposureReport; graph: Graph; dj: ReturnType<typeof dijkstra> } {
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
  const actorIndex = new Map(actors.map((x, k) => [x.id, k]))
  const cid = (id: string): number => {
    const a = actorIndex.get(id)
    if (a != null) return a
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
    // Value: a grant path uses the best grant level; a network (host) path uses weights.networkValue.
    const rg = grantsByResource.get(id) ?? []
    let level: MithGrantLevel | null = null
    for (const gr of rg) if (level == null || LEVEL_FACTOR[gr.level] > LEVEL_FACTOR[level]) level = gr.level
    const factor = viaNetwork || level == null ? g.weights.networkValue : LEVEL_FACTOR[level]
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
        score: scoreOf(ease, CRITICALITY_WEIGHT[declaredCrit] * g.weights.networkValue),
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

  // ---- Zone frontiers: what a foothold in each zone reaches over the network ----
  const net = zoneNetwork(g, crit)
  // ---- Role scores: best of (grant value / cost to seize) and (network value / (cost to seize + network cost)) ----
  const roleScores: RoleScore[] = roles.map((r) => {
    const i = g.index.get(r.id)!
    const ease = easeOf(i)
    const dA = Number.isFinite(dist[i]!) ? dist[i]! : Infinity
    const direct = roleGrantValue.get(r.id)
    let value = direct?.value ?? 0
    let topResource = direct?.resource ?? null
    let topCost = 0
    let viaNet = false
    // Ranking key: value / (dA + cost). For unreachable roles rank by value / (1 + cost).
    const base = Number.isFinite(dA) ? dA : 1
    let best = value / base
    const held = grantsByRole.get(r.id)
    for (const x of g.roleZones.get(i) ?? []) {
      for (const f of net.frontier[x.zone - g.zoneStart] ?? []) {
        if (held?.has(g.ids[f.sys]!)) continue
        const v = f.value * g.weights.networkValue
        const c = x.cost + f.cost
        const k = v / (base + c)
        if (k > best + 1e-12) {
          best = k
          value = v
          topResource = g.ids[f.sys]!
          topCost = c
          viaNet = true
        }
      }
    }
    const high = [...(held ?? [])].some((res) => isHighValueGrant(bestLevel(grants, r.id, res), crit.get(res)))
    const k = nA + roleIndex.get(r.id)!
    return {
      role: r.id,
      highValue: high,
      value,
      topResource,
      topCost,
      minCost: Number.isFinite(dA) ? dA : null,
      ease,
      score: Number.isFinite(dA) ? Math.round((1000 * value) / (MAX_VALUE * (dA + topCost))) / 10 : 0,
      easiest: easiestFor(g, dj, i),
      paths: pathCount[k]!,
      unverifiedPaths: unvCount[k]!,
      minHops: minHops[k]! >= 0 ? minHops[k]! : null,
      minUnverifiedHops: minUnv[k]! >= 0 ? minUnv[k]! : null,
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
  const shadowEntries = shadowSaaSEntries(g, model, net)

  let paths = 0, unverifiedPaths = 0, reachableRoles = 0
  for (const r of roleScores) {
    paths += r.paths
    unverifiedPaths += r.unverifiedPaths
    if (r.minCost != null) reachableRoles++
  }
  const report: ExposureReport = {
    roles: roleScores,
    resources,
    networkExposures,
    shadowEntries,
    zones: net.zones,
    totals: {
      actors: g.modelActors,
      roles: roles.length,
      channels: usable.length,
      zones: g.zoneEnd - g.zoneStart,
      reachEdges: (model.reach ?? []).length,
      paths,
      unverifiedPaths,
      reachableRoles,
      reachableSystems,
      networkOnlySystems,
      openToCrownJewelZones: net.zones.filter((z) => z.openToCrownJewel).length,
      shadowToCrownJewel: shadowEntries.filter((x) => x.crownJewelCost != null && x.crownJewelCost <= g.weights.blastRadius + 1e-9).length,
      capped,
      maxHops,
    },
  }
  return { report, graph: g, dj }
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

const NET_EDGES = (1 << EDGE.reach) | (1 << EDGE.host)
const SHADOW_EDGES = NET_EDGES | (1 << EDGE.sync)
/** Upper bound on network cost explored from one zone (keeps per-zone searches small). */
export const NETWORK_COST_CAP = 24

/** Reusable bounded Dijkstra over a subset of edge types. Returns touched nodes with their cost. */
function makeBounded(g: Graph) {
  const n = g.ids.length
  const dist = new Float64Array(n).fill(Infinity)
  const touched: number[] = []
  return (src: number, mask: number, cap: number, visit: (node: number, d: number) => void) => {
    for (const t of touched) dist[t] = Infinity
    touched.length = 0
    const heap = new MinHeap()
    dist[src] = 0
    touched.push(src)
    heap.push(0, src)
    while (heap.size) {
      const [d, u] = heap.pop()
      if (d > dist[u]!) continue
      visit(u, d)
      for (let e = g.deg[u]!; e < g.deg[u + 1]!; e++) {
        if (!((mask >> g.eType[e]!) & 1)) continue
        const v = g.eTo[e]!
        const nd = d + g.eCost[e]!
        if (nd <= cap && nd < dist[v]!) {
          if (dist[v] === Infinity) touched.push(v)
          dist[v] = nd
          heap.push(nd, v)
        }
      }
    }
  }
}

type Frontier = { sys: number; cost: number; value: number }[]

/**
 * Per-zone network search (reach + host edges, blocked impassable): a Pareto frontier of
 * (cost, system value) for role scoring, plus crown-jewel reach per zone.
 */
function zoneNetwork(g: Graph, crit: Map<string, MithCriticality | undefined>) {
  const run = makeBounded(g)
  const nz = g.zoneEnd - g.zoneStart
  const frontier: Frontier[] = new Array(nz)
  const zones: ZoneScore[] = []
  const valueOf = (sys: number) => CRITICALITY_WEIGHT[crit.get(g.ids[sys]!) ?? 'medium']
  const isCJ = (sys: number) => crit.get(g.ids[sys]!) === 'crown-jewel'
  // Zones hosting a crown jewel, and open-only reach adjacency.
  const hostsCJ = new Uint8Array(nz)
  for (let z = g.zoneStart; z < g.zoneEnd; z++) {
    for (let e = g.deg[z]!; e < g.deg[z + 1]!; e++) if (g.eType[e] === EDGE.host && isCJ(g.eTo[e]!)) hostsCJ[z - g.zoneStart] = 1
  }
  const openReach = (z: number) => {
    const out: number[] = []
    for (let e = g.deg[z]!; e < g.deg[z + 1]!; e++) if (g.eType[e] === EDGE.reach && g.eUnv[e] === 1) out.push(g.eTo[e]!)
    return out
  }
  for (let z = g.zoneStart; z < g.zoneEnd; z++) {
    const found: Frontier = []
    let reachableZones = 0
    let cjCost: number | null = null
    let cj: string | null = null
    run(z, NET_EDGES, NETWORK_COST_CAP, (node, d) => {
      const t = g.nodeType[node]
      if (t === NODE.zone) { if (node !== z) reachableZones++ }
      else if (t === NODE.system) {
        found.push({ sys: node, cost: d, value: valueOf(node) })
        if (isCJ(node) && cjCost == null) { cjCost = d; cj = g.ids[node]! }
      }
    })
    // Pareto: visited in cost order; keep a system only if its value beats every cheaper one.
    const front: Frontier = []
    let bestV = -1
    for (const f of found) if (f.value > bestV) { front.push(f); bestV = f.value }
    frontier[z - g.zoneStart] = front
    // Open-only path (≥ 1 hop) into a zone hosting a crown jewel.
    let open = false
    const seen = new Set<number>([z])
    const stack = openReach(z)
    for (const s of stack) seen.add(s)
    while (stack.length && !open) {
      const u = stack.pop()!
      if (hostsCJ[u - g.zoneStart]) { open = true; break }
      for (const v of openReach(u)) if (!seen.has(v)) { seen.add(v); stack.push(v) }
    }
    zones.push({
      zone: g.ids[z]!,
      hostsCrownJewel: hostsCJ[z - g.zoneStart] === 1,
      openToCrownJewel: open,
      crownJewelCost: cjCost,
      crownJewel: cj,
      reachableZones,
    })
  }
  zones.sort((a, b) => Number(b.openToCrownJewel) - Number(a.openToCrownJewel) || (a.crownJewelCost ?? 1e9) - (b.crownJewelCost ?? 1e9) || a.zone.localeCompare(b.zone))
  return { frontier, zones, run, isCJ }
}

function shadowSaaSEntries(g: Graph, model: Input, net: ReturnType<typeof zoneNetwork>): ShadowEntry[] {
  const usesCount = new Map<string, number>()
  for (const e of model.edges) if (e.kind === 'uses') usesCount.set(e.target, (usesCount.get(e.target) ?? 0) + 1)
  const out: ShadowEntry[] = []
  for (const e of model.entities) {
    if (e.layer !== 'server' || e.sanctioned !== false) continue
    const si = g.index.get(e.id)
    let syncZones = 0
    let reachableZones = 0
    let cjCost: number | null = null
    let cj: string | null = null
    if (si != null) {
      for (let ed = g.deg[si]!; ed < g.deg[si + 1]!; ed++) if (g.eType[ed] === EDGE.sync) syncZones++
      net.run(si, SHADOW_EDGES, NETWORK_COST_CAP, (node, d) => {
        const t = g.nodeType[node]
        if (t === NODE.zone) reachableZones++
        else if (t === NODE.system && node !== si && net.isCJ(node) && cjCost == null) { cjCost = d; cj = g.ids[node]! }
      })
    }
    out.push({
      system: e.id,
      zone: e.zone ?? null,
      syncZones,
      reachableZones,
      reachesCrownJewelZone: cjCost != null,
      crownJewelCost: cjCost,
      crownJewel: cj,
      usedBy: usesCount.get(e.id) ?? 0,
    })
  }
  out.sort(
    (a, b) =>
      Number(b.reachesCrownJewelZone) - Number(a.reachesCrownJewelZone) ||
      (a.crownJewelCost ?? 1e9) - (b.crownJewelCost ?? 1e9) ||
      b.reachableZones - a.reachableZones ||
      b.usedBy - a.usedBy ||
      a.system.localeCompare(b.system),
  )
  return out
}

// Kept for callers importing the constant list of controls.
export { DEFAULT_CONTROL_WEIGHTS }
export type { MithVerification }
