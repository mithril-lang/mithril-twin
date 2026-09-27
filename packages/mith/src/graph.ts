import type {
  MithChannel,
  MithDeviceLogs,
  MithDocument,
  MithReachKind,
  MithSoftware,
  MithVerification,
  MithVulnSeverity,
  MithWeights,
} from './types'

/**
 * Unified org + network attack graph. Display-only arithmetic over the parsed document.
 *
 * Nodes: external actors, roles, devices, network zones, and systems (resources).
 * Edges, each with a bypass-difficulty cost:
 *   - channel   actor/role → role     base + control weights (weak controls still cross)
 *   - pivot     role → holder device  (an impersonated identity uses its holder's device)
 *               role → zone           when no device is modeled (role.zone / holder zone)
 *   - device    device → its zone     cost 0 (the device sits in that zone)
 *   - reach     zone → zone           open lightest, conditional heavier, blocked impassable
 *   - host      zone → system         a system hosted in a zone you already stand in
 *   - grant     role → system         cost 0; the grant level is captured in the system value
 *   - entry     internet → shadow SaaS  unsanctioned SaaS is reachable from outside (cost base)
 *   - sync      shadow SaaS → zone    the SaaS syncs into the zone of the departments using it
 *                                     (oauth-grant = open reach cost, otherwise conditional)
 *
 * A path can therefore cross both dimensions:
 *   actor → channel → role → device → zone → reach → zone → host → system, or
 *   internet → shadow SaaS → sync → zone → reach → zone → host → system.
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
/** Value factor for a system reached over the network without a grant. */
export const DEFAULT_NETWORK_VALUE = 0.6
/** Cost of a reach edge through a jump host / bastion (`reach.jumpHost`). */
export const DEFAULT_JUMP_HOST_COST = 2
/** Tile heat saturates (fully red) at this share of hot roles. */
export const DEFAULT_HEAT_SATURATION = 0.25

/** Device compromise ease from installed software (display-only arithmetic, each term in [0, 1]). */
export const DEFAULT_DEVICE_WEIGHTS = {
  eol: 0.3,
  unsanctioned: 0.15,
  vulnerability: { low: 0.05, medium: 0.15, high: 0.3, critical: 0.45 },
  maxEase: 0.8,
} as const
/** Forwarded logs kept for fewer days than this read as a short-retention gap. */
export const DEFAULT_MIN_RETENTION_DAYS = 30

export type DeviceWeights = {
  eol: number
  unsanctioned: number
  vulnerability: Record<Exclude<MithVulnSeverity, 'none'>, number>
  maxEase: number
}

export type ResolvedWeights = {
  base: number
  controls: Record<MithVerification, number>
  reach: Record<MithReachKind, number>
  pivot: number
  host: number
  blastRadius: number
  networkValue: number
  jumpHost: number
  sync: { open: number; conditional: number }
  heatSaturation: number
  device: DeviceWeights
  minRetentionDays: number
}

export function resolveWeights(w?: MithWeights): ResolvedWeights {
  const reach = { ...DEFAULT_REACH_WEIGHTS, ...(w?.reach ?? {}) }
  return {
    base: w?.base ?? BASE_HOP_COST,
    controls: { ...DEFAULT_CONTROL_WEIGHTS, ...(w?.controls ?? {}) },
    reach,
    pivot: w?.pivot ?? DEFAULT_PIVOT_COST,
    host: w?.host ?? DEFAULT_HOST_COST,
    blastRadius: w?.blastRadius ?? DEFAULT_BLAST_COST,
    networkValue: w?.networkValue ?? DEFAULT_NETWORK_VALUE,
    jumpHost: w?.jumpHost ?? DEFAULT_JUMP_HOST_COST,
    // Sync defaults follow the (possibly overridden) reach weights, as before.
    sync: { open: w?.sync?.open ?? reach.open, conditional: w?.sync?.conditional ?? reach.conditional },
    heatSaturation: w?.heatSaturation ?? DEFAULT_HEAT_SATURATION,
    device: {
      eol: w?.device?.eol ?? DEFAULT_DEVICE_WEIGHTS.eol,
      unsanctioned: w?.device?.unsanctioned ?? DEFAULT_DEVICE_WEIGHTS.unsanctioned,
      vulnerability: { ...DEFAULT_DEVICE_WEIGHTS.vulnerability, ...(w?.device?.vulnerability ?? {}) },
      maxEase: w?.device?.maxEase ?? DEFAULT_DEVICE_WEIGHTS.maxEase,
    },
    minRetentionDays: w?.minRetentionDays ?? DEFAULT_MIN_RETENTION_DAYS,
  }
}

const VULN_RANK: Record<MithVulnSeverity, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 }

export type DeviceRisk = {
  /** 0 … maxEase. The role → device pivot costs `pivot × (1 − ease)`. */
  ease: number
  eol: number
  unsanctioned: number
  worst: MithVulnSeverity
  /** Short human reasons, e.g. "EOL: PDF viewer 9.1". */
  reasons: string[]
}

/** Light software scoring for one device. No software modeled → ease 0. */
export function deviceRisk(software: readonly MithSoftware[] | undefined, w: DeviceWeights): DeviceRisk {
  let eol = 0
  let unsanctioned = 0
  let worst: MithVulnSeverity = 'none'
  const reasons: string[] = []
  for (const s of software ?? []) {
    const tag = `${s.name} ${s.version}`
    if (s.eol) { eol++; reasons.push(`EOL: ${tag}`) }
    if (s.sanctioned === false) { unsanctioned++; reasons.push(`unsanctioned: ${tag}`) }
    const v = s.vulnerability ?? 'none'
    if (v !== 'none') reasons.push(`${v} vuln: ${tag}`)
    if (VULN_RANK[v] > VULN_RANK[worst]) worst = v
  }
  const raw = (eol ? w.eol : 0) + (unsanctioned ? w.unsanctioned : 0) + (worst === 'none' ? 0 : w.vulnerability[worst])
  return { ease: Math.min(w.maxEase, raw), eol, unsanctioned, worst, reasons }
}

/**
 * Log coverage for one device: `forwarded` (to a destination, retention ≥ minimum), `short`
 * (forwarded but kept < minRetentionDays), `blind` (not forwarded, or no sources), or `unknown`
 * (no logs block modeled — not flagged, we only report what the document states).
 */
export type LogCoverage = 'forwarded' | 'short' | 'blind' | 'unknown'
export function logCoverage(logs: MithDeviceLogs | undefined, minRetentionDays: number): LogCoverage {
  if (!logs) return 'unknown'
  if (logs.forwardTo === 'none' || logs.sources.length === 0) return 'blind'
  if (logs.retentionDays < minRetentionDays) return 'short'
  return 'forwarded'
}

export function channelCost(channel: Pick<MithChannel, 'verification'>, w: ResolvedWeights): number {
  let cost = w.base
  for (const v of new Set(channel.verification)) cost += w.controls[v]
  return cost
}

export const EDGE = { channel: 0, pivot: 1, reach: 2, host: 3, grant: 4, device: 5, entry: 6, sync: 7 } as const
export type EdgeType = (typeof EDGE)[keyof typeof EDGE]
export const NODE = { actor: 0, role: 1, zone: 2, system: 3, device: 4 } as const
/** Implicit actor added when the document has unsanctioned SaaS used by the org. */
export const INTERNET_ACTOR = 'actor:internet'
export type NodeType = (typeof NODE)[keyof typeof NODE]

export type Graph = {
  ids: string[]
  nodeType: Uint8Array
  index: Map<string, number>
  nA: number
  roleStart: number
  roleEnd: number
  devStart: number
  devEnd: number
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
  /** Zones a role stands in after impersonation, with the pivot cost (via device or directly). */
  roleZones: Map<number, { zone: number; cost: number; device: number }[]>
  /** Model actor count (the implicit internet actor, when present, is extra). */
  modelActors: number
  /** Per device node (index − devStart): software ease, its reasons, and log coverage. */
  devEase: Float64Array
  devReasons: string[][]
  devCoverage: LogCoverage[]
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
  // Device nodes: node-layer entities that sit in a zone. `attrs.owner` names the person.
  const devices = model.entities.filter((e) => e.layer === 'node' && e.zone)
  const shadowUsed = new Set(model.edges.filter((e) => e.kind === 'uses').map((e) => e.target))
  const shadow = model.entities.filter((e) => e.layer === 'server' && e.sanctioned === false && shadowUsed.has(e.id))
  const implicitActor = shadow.length > 0 && !actors.some((a) => a.id === INTERNET_ACTOR)

  const ids: string[] = [
    ...actors.map((a) => a.id),
    ...(implicitActor ? [INTERNET_ACTOR] : []),
    ...roles.map((r) => r.id),
    ...devices.map((d) => d.id),
    ...zones.map((z) => z.id),
    ...systems,
  ]
  const index = new Map<string, number>()
  ids.forEach((id, i) => index.set(id, i))
  const nA = actors.length + (implicitActor ? 1 : 0)
  const roleStart = nA
  const roleEnd = roleStart + roles.length
  const devStart = roleEnd
  const devEnd = devStart + devices.length
  const zoneStart = devEnd
  const zoneEnd = zoneStart + zones.length
  const sysStart = zoneEnd
  const sysEnd = sysStart + systems.length
  const n = ids.length
  const nodeType = new Uint8Array(n)
  for (let i = roleStart; i < roleEnd; i++) nodeType[i] = NODE.role
  for (let i = devStart; i < devEnd; i++) nodeType[i] = NODE.device
  for (let i = zoneStart; i < zoneEnd; i++) nodeType[i] = NODE.zone
  for (let i = sysStart; i < sysEnd; i++) nodeType[i] = NODE.system

  // Zone of a role's holders: role.zone wins, else the distinct zones of holder people.
  const entityById = new Map(model.entities.map((e) => [e.id, e]))
  const devicesByOwner = new Map<string, number[]>()
  const link = (person: string, d: number) => {
    const list = devicesByOwner.get(person) ?? []
    if (!list.includes(d)) list.push(d)
    devicesByOwner.set(person, list)
  }
  const devEase = new Float64Array(devices.length)
  const devReasons: string[][] = new Array(devices.length)
  const devCoverage: LogCoverage[] = new Array(devices.length)
  devices.forEach((d, k) => {
    const o = d.attrs?.owner
    if (o) link(o, devStart + k)
    // Every linked person (primary, shared user, admin) can stand on the device after impersonation.
    for (const u of d.users ?? []) link(u.person, devStart + k)
    const risk = deviceRisk(d.software, w.device)
    devEase[k] = risk.ease
    devReasons[k] = risk.reasons
    devCoverage[k] = logCoverage(d.logs, w.minRetentionDays)
  })
  const roleZone = new Map<string, string[]>()
  const roleZones = new Map<number, { zone: number; cost: number; device: number }[]>()
  for (const r of roles) {
    const ri = index.get(r.id)!
    const zs = new Set<string>()
    const devs: number[] = []
    for (const h of r.holders) for (const d of devicesByOwner.get(h) ?? []) devs.push(d)
    const list: { zone: number; cost: number; device: number }[] = []
    for (const d of devs) {
      const z = devices[d - devStart]!.zone!
      const zi = index.get(z)
      if (zi == null) continue
      zs.add(z)
      // Per zone keep the easiest device: pivot × (1 − ease).
      const c = w.pivot * (1 - devEase[d - devStart]!)
      const at = list.findIndex((x) => x.zone === zi)
      if (at < 0) list.push({ zone: zi, cost: c, device: d })
      else if (c < list[at]!.cost) list[at] = { zone: zi, cost: c, device: d }
    }
    if (r.zone) zs.add(r.zone)
    if (!devs.length) for (const h of r.holders) { const z = entityById.get(h)?.zone; if (z) zs.add(z) }
    for (const z of zs) {
      const zi = index.get(z)
      if (zi != null && !list.some((x) => x.zone === zi)) list.push({ zone: zi, cost: w.pivot, device: -1 })
    }
    if (zs.size) roleZone.set(r.id, [...zs])
    if (list.length) roleZones.set(ri, list)
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
  for (const [ri, list] of roleZones) {
    const seenDev = new Set<number>()
    for (const x of list) {
      if (x.device >= 0) {
        if (seenDev.has(x.device)) continue
        seenDev.add(x.device)
        push(ri, x.device, x.cost, EDGE.pivot, 0, `pivot:${ids[ri]}`)
      } else push(ri, x.zone, x.cost, EDGE.pivot, 0, `pivot:${ids[ri]}`)
    }
  }
  for (let d = devStart; d < devEnd; d++) {
    const t = index.get(devices[d - devStart]!.zone!)
    if (t != null) push(d, t, 0, EDGE.device, 0, `on:${ids[d]}`)
  }
  // Shadow-IT SaaS entry: internet → SaaS → zones of the departments / people using it.
  if (shadow.length) {
    const inet = index.get(INTERNET_ACTOR)!
    const parent = new Map((model.boundaries ?? []).map((b) => [b.id, b.parent]))
    const zonesOfBoundary = new Map<string, Set<number>>()
    const addBZ = (b: string, zi: number) => {
      let cur: string | undefined = b
      let guard = 0
      while (cur && guard++ < 12) {
        const set = zonesOfBoundary.get(cur) ?? new Set<number>()
        set.add(zi)
        zonesOfBoundary.set(cur, set)
        cur = parent.get(cur)
      }
    }
    for (const r of roles) for (const x of roleZones.get(index.get(r.id)!) ?? []) addBZ(r.boundary, x.zone)
    const usesBy = new Map<string, string[]>()
    for (const e of model.edges) if (e.kind === 'uses') usesBy.set(e.target, [...(usesBy.get(e.target) ?? []), e.source])
    for (const sys of shadow) {
      const si = index.get(sys.id)!
      push(inet, si, w.base, EDGE.entry, sys.source === 'sso-missing' ? 1 : 0, `entry:${sys.id}`)
      const open = sys.source === 'oauth-grant'
      const targets = new Set<number>()
      for (const u of usesBy.get(sys.id) ?? []) {
        const ent = entityById.get(u)
        const z = ent?.zone ? index.get(ent.zone) : undefined
        if (z != null) targets.add(z)
        for (const zi of zonesOfBoundary.get(u) ?? []) targets.add(zi)
      }
      for (const t of targets) push(si, t, open ? w.sync.open : w.sync.conditional, EDGE.sync, open ? 1 : 0, `sync:${sys.id}`)
    }
  }
  for (const rc of reach) {
    const f = index.get(rc.from)
    const t = index.get(rc.to)
    if (f == null || t == null) continue
    const c = rc.weight ?? (rc.jumpHost && rc.kind !== 'blocked' ? w.jumpHost : w.reach[rc.kind])
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
    roleStart, roleEnd, devStart, devEnd, zoneStart, zoneEnd, sysStart, sysEnd,
    deg, eTo, eCost, eType, eUnv, eRef, weights: w, roleZone, roleZones,
    modelActors: actors.length,
    devEase, devReasons, devCoverage,
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

/** One hop of a mixed org + network path. `red`: channel without verification, open network reach, open SaaS sync. */
export type MixedHop = {
  from: string
  to: string
  kind: string
  edge: EdgeType
  cost: number
  red: boolean
  ref: string
  /**
   * Set on hops that land on a device whose logs are not forwarded (`blind`) or kept too briefly
   * (`short`): a detection blind spot. Explanation only — it never changes reachability or cost.
   */
  blind?: 'blind' | 'short'
  /** Why this hop is cheaper / notable, e.g. software ease reasons and the coverage gap. */
  notes?: string[]
}

const EDGE_KIND: Record<EdgeType, string> = {
  [EDGE.channel]: 'channel',
  [EDGE.pivot]: 'holder device / zone',
  [EDGE.device]: 'device on zone',
  [EDGE.entry]: 'internet → shadow SaaS',
  [EDGE.sync]: 'SaaS sync into zone',
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
    const hop: MixedHop = {
      from: g.ids[p]!,
      to: g.ids[cur]!,
      kind: ty === EDGE.channel ? channelRef(g, e) : ty === EDGE.pivot ? (g.nodeType[cur] === NODE.device ? 'holder device' : 'pivot to zone') : EDGE_KIND[ty],
      edge: ty,
      cost: g.eCost[e]!,
      red: g.eUnv[e]! === 1,
      ref: g.eRef[e]!,
    }
    if (g.nodeType[cur] === NODE.device) Object.assign(hop, deviceHopNotes(g, cur - g.devStart))
    hops.unshift(hop)
    cur = p
  }
  return hops
}

function deviceHopNotes(g: Graph, k: number): Pick<MixedHop, 'blind' | 'notes'> {
  const notes: string[] = []
  const ease = g.devEase[k] ?? 0
  if (ease > 0) notes.push(`device ease ${ease.toFixed(2)} (${(g.devReasons[k] ?? []).slice(0, 3).join('; ')})`)
  const cov = g.devCoverage[k]
  let blind: MixedHop['blind']
  if (cov === 'blind') { blind = 'blind'; notes.push('detection blind spot: device logs are not forwarded') }
  else if (cov === 'short') { blind = 'short'; notes.push(`detection gap: log retention below ${g.weights.minRetentionDays} days`) }
  return { ...(blind ? { blind } : {}), ...(notes.length ? { notes } : {}) }
}

function channelRef(g: Graph, e: number): string {
  return g.eUnv[e]! === 1 ? 'channel · no verification' : 'channel'
}

export const REACH_OPEN_MARK = 1
