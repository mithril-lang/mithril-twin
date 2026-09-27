import type {
  MithChannel,
  MithDocument,
  MithReachKind,
  MithVerification,
  MithWeights,
} from './types'

/**
 * Unified org + network attack graph. Display-only arithmetic over the parsed document.
 *
 * Nodes: external actors, roles, network zones, and systems (resources).
 * Edges, each with a bypass-difficulty cost:
 *   - channel   actor/role → role     base + control weights (weak controls still cross)
 *   - pivot     role → its device zone (an impersonated identity stands in its zone)
 *   - reach     zone → zone           open lightest, conditional heavier, blocked impassable
 *   - host      zone → system         a system hosted in a zone you already stand in
 *   - grant     role → system         cost 0; the grant level is captured in the system value
 *
 * A path can therefore cross both dimensions:
 *   actor → channel → role → pivot → zone → reach → zone → host → system.
 *
 * Weights are tunable ranking defaults, overridable per document. They are NOT claims about
 * real-world bypass success rates.
 */

export const BASE_HOP_COST = 1
export const DEFAULT_CONTROL_WEIGHTS: Record<MithVerification, number> = {
  none: 0,
  callback: 2,
  mfa: 5,
  'dual-approval': 9,
}
/** Zone→zone reach cost by kind. `blocked` is impassable unless a document overrides it. */
export const DEFAULT_REACH_WEIGHTS: Record<MithReachKind, number> = {
  open: 1,
  conditional: 4,
  blocked: Infinity,
}
export const DEFAULT_PIVOT_COST = 1
export const DEFAULT_HOST_COST = 1
/**
 * Blast radius cost threshold. 6 lets an impersonated role cross one unverified hop plus a
 * callback (1 + 3) or one mfa hop (6), and reach through open network segments, but not through
 * dual-approval (10) or a conditional firewall after another control.
 */
export const DEFAULT_BLAST_COST = 6

export type ResolvedWeights = {
  base: number
  controls: Record<MithVerification, number>
  reach: Record<MithReachKind, number>
  pivot: number
  host: number
  blastRadius: number
}

export function resolveWeights(w?: MithWeights): ResolvedWeights {
  return {
    base: w?.base ?? BASE_HOP_COST,
    controls: { ...DEFAULT_CONTROL_WEIGHTS, ...(w?.controls ?? {}) },
    reach: { ...DEFAULT_REACH_WEIGHTS, ...(w?.reach ?? {}) },
    pivot: w?.pivot ?? DEFAULT_PIVOT_COST,
    host: w?.host ?? DEFAULT_HOST_COST,
    blastRadius: w?.blastRadius ?? DEFAULT_BLAST_COST,
  }
}

export function channelCost(channel: Pick<MithChannel, 'verification'>, w: ResolvedWeights): number {
  let cost = w.base
  for (const v of new Set(channel.verification)) cost += w.controls[v]
  return cost
}

export const EDGE = { channel: 0, pivot: 1, reach: 2, host: 3, grant: 4 } as const
export type EdgeType = (typeof EDGE)[keyof typeof EDGE]
export const NODE = { actor: 0, role: 1, zone: 2, system: 3 } as const
export type NodeType = (typeof NODE)[keyof typeof NODE]

export type Graph = {
  ids: string[]
  nodeType: Uint8Array
  index: Map<string, number>
  nA: number
  roleStart: number
  roleEnd: number
  zoneStart: number
  zoneEnd: number
  sysStart: number
  sysEnd: number
  // CSR adjacency
  deg: Int32Array
  eTo: Int32Array
  eCost: Float64Array
  eType: Uint8Array
  eUnv: Uint8Array
  /** Display id per edge: channel id, reach id, or a synthetic label. */
  eRef: string[]
  weights: ResolvedWeights
  roleZone: Map<string, string[]>
}

type Model = MithDocument['model']

/** Build the unified graph once. O(V + E). */
export function buildGraph(model: Model): Graph {
  const w = resolveWeights(model.weights)
  const actors = model.actors ?? []
  const roles = model.roles ?? []
  const zones = model.entities.filter((e) => e.layer === 'network')
  const grants = model.grants ?? []
  const channels = model.channels ?? []
  const reach = model.reach ?? []

  // System nodes: every server-layer entity plus any resource named by a grant.
  const sysSet = new Map<string, string>()
  for (const e of model.entities) if (e.layer === 'server') sysSet.set(e.id, e.id)
  for (const g of grants) if (!sysSet.has(g.resource)) sysSet.set(g.resource, g.resource)
  const systems = [...sysSet.keys()]

  const ids: string[] = [
    ...actors.map((a) => a.id),
    ...roles.map((r) => r.id),
    ...zones.map((z) => z.id),
    ...systems,
  ]
  const index = new Map<string, number>()
  ids.forEach((id, i) => index.set(id, i))
  const nA = actors.length
  const roleStart = nA
  const roleEnd = roleStart + roles.length
  const zoneStart = roleEnd
  const zoneEnd = zoneStart + zones.length
  const sysStart = zoneEnd
  const sysEnd = sysStart + systems.length
  const n = ids.length
  const nodeType = new Uint8Array(n)
  for (let i = roleStart; i < roleEnd; i++) nodeType[i] = NODE.role
  for (let i = zoneStart; i < zoneEnd; i++) nodeType[i] = NODE.zone
  for (let i = sysStart; i < sysEnd; i++) nodeType[i] = NODE.system

  // Zone of a role's holders: role.zone wins, else the distinct zones of holder people.
  const entityById = new Map(model.entities.map((e) => [e.id, e]))
  const roleZone = new Map<string, string[]>()
  for (const r of roles) {
    const zs = new Set<string>()
    if (r.zone) zs.add(r.zone)
    else for (const h of r.holders) { const z = entityById.get(h)?.zone; if (z) zs.add(z) }
    if (zs.size) roleZone.set(r.id, [...zs])
  }

  // Gather edges, then pack CSR.
  const from: number[] = []
  const to: number[] = []
  const cost: number[] = []
  const type: number[] = []
  const unv: number[] = []
  const ref: string[] = []
  const push = (f: number, t: number, c: number, ty: number, u: number, rf: string) => {
    if (!Number.isFinite(c)) return // blocked / impassable
    from.push(f); to.push(t); cost.push(c); type.push(ty); unv.push(u); ref.push(rf)
  }
  for (const c of channels) {
    const f = index.get(c.from)
    const t = index.get(c.to)
    if (f == null || t == null || t < roleStart || t >= roleEnd) continue
    const u = c.verification.every((v) => v === 'none') ? 1 : 0
    push(f, t, channelCost(c, w), EDGE.channel, u, c.id)
  }
  for (const r of roles) {
    const f = index.get(r.id)!
    for (const z of roleZone.get(r.id) ?? []) {
      const t = index.get(z)
      if (t != null) push(f, t, w.pivot, EDGE.pivot, 0, `pivot:${r.id}`)
    }
  }
  for (const rc of reach) {
    const f = index.get(rc.from)
    const t = index.get(rc.to)
    if (f == null || t == null) continue
    const c = rc.weight ?? w.reach[rc.kind]
    push(f, t, c, EDGE.reach, rc.kind === 'open' ? 1 : 0, rc.id)
  }
  for (const e of model.entities) {
    if (e.layer !== 'server' || !e.zone) continue
    const f = index.get(e.zone)
    const t = index.get(e.id)
    if (f != null && t != null) push(f, t, w.host, EDGE.host, 0, `host:${e.id}`)
  }
  for (const g of grants) {
    const f = index.get(g.role)
    const t = index.get(g.resource)
    if (f != null && t != null) push(f, t, 0, EDGE.grant, 0, g.id)
  }

  const m = from.length
  const deg = new Int32Array(n + 1)
  for (const f of from) deg[f + 1]! += 1
  for (let i = 0; i < n; i++) deg[i + 1]! += deg[i]!
  const fill = deg.slice(0, n)
  const eTo = new Int32Array(m)
  const eCost = new Float64Array(m)
  const eType = new Uint8Array(m)
  const eUnv = new Uint8Array(m)
  const eRef: string[] = new Array(m)
  for (let i = 0; i < m; i++) {
    const at = fill[from[i]!]!++
    eTo[at] = to[i]!
    eCost[at] = cost[i]!
    eType[at] = type[i]!
    eUnv[at] = unv[i]!
    eRef[at] = ref[i]!
  }
  return {
    ids, nodeType, index, nA,
    roleStart, roleEnd, zoneStart, zoneEnd, sysStart, sysEnd,
    deg, eTo, eCost, eType, eUnv, eRef, weights: w, roleZone,
  }
}

export class MinHeap {
  private k: number[] = []
  private v: number[] = []
  get size() { return this.k.length }
  push(key: number, val: number) {
    const k = this.k, v = this.v
    let i = k.length
    k.push(key); v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p]! <= key) break
      k[i] = k[p]!; v[i] = v[p]!; i = p
    }
    k[i] = key; v[i] = val
  }
  pop(): [number, number] {
    const k = this.k, v = this.v
    const topK = k[0]!, topV = v[0]!
    const lastK = k.pop()!, lastV = v.pop()!
    const n = k.length
    if (n) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const r = l + 1
        const c = r < n && k[r]! < k[l]! ? r : l
        if (k[c]! >= lastK) break
        k[i] = k[c]!; v[i] = v[c]!; i = c
      }
      k[i] = lastK; v[i] = lastV
    }
    return [topK, topV]
  }
}

export type Dijkstra = { dist: Float64Array; prevNode: Int32Array; prevEdge: Int32Array }

/** Multi-source Dijkstra. `sources` are node indices seeded at cost 0. */
export function dijkstra(g: Graph, sources: number[]): Dijkstra {
  const n = g.ids.length
  const dist = new Float64Array(n).fill(Infinity)
  const prevNode = new Int32Array(n).fill(-1)
  const prevEdge = new Int32Array(n).fill(-1)
  const heap = new MinHeap()
  for (const s of sources) { dist[s] = 0; heap.push(0, s) }
  while (heap.size) {
    const [d, u] = heap.pop()
    if (d > dist[u]!) continue
    for (let e = g.deg[u]!; e < g.deg[u + 1]!; e++) {
      const v = g.eTo[e]!
      const nd = d + g.eCost[e]!
      if (nd < dist[v]!) {
        dist[v] = nd
        prevNode[v] = u
        prevEdge[v] = e
        heap.push(nd, v)
      }
    }
  }
  return { dist, prevNode, prevEdge }
}

/** One hop of a mixed org + network path. `red`: channel without verification, or open network reach. */
export type MixedHop = { from: string; to: string; kind: string; edge: EdgeType; cost: number; red: boolean; ref: string }

const EDGE_KIND: Record<EdgeType, string> = {
  [EDGE.channel]: 'channel',
  [EDGE.pivot]: 'pivot to zone',
  [EDGE.reach]: 'network reach',
  [EDGE.host]: 'hosted in zone',
  [EDGE.grant]: 'grant',
}

/** Reconstruct the cheapest path to `target` as mixed org + network hops. */
export function reconstruct(g: Graph, dj: Dijkstra, target: number): MixedHop[] {
  if (!Number.isFinite(dj.dist[target]!)) return []
  const hops: MixedHop[] = []
  let cur = target
  while (dj.prevNode[cur]! >= 0) {
    const p = dj.prevNode[cur]!
    const e = dj.prevEdge[cur]!
    const ty = g.eType[e]! as EdgeType
    hops.unshift({
      from: g.ids[p]!,
      to: g.ids[cur]!,
      kind: ty === EDGE.channel ? channelRef(g, e) : EDGE_KIND[ty],
      edge: ty,
      cost: g.eCost[e]!,
      red: g.eUnv[e]! === 1,
      ref: g.eRef[e]!,
    })
    cur = p
  }
  return hops
}

function channelRef(g: Graph, e: number): string {
  return g.eUnv[e]! === 1 ? 'channel · no verification' : 'channel'
}

export const REACH_OPEN_MARK = 1
