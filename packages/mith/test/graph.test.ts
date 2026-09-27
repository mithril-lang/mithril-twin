import { describe, expect, it } from 'vitest'
import { analyzeExposure, analyzeExposureGraph } from '../src/exposure'
import { buildGraph, dijkstra, EDGE, INTERNET_ACTOR, reconstruct, resolveWeights } from '../src/graph'
import { blastRadius } from '../src/org'
import { MithParseError, parseMith } from '../src/parse'
import type { MithDocument } from '../src/types'

const ent = (id: string, layer: string, extra: Record<string, unknown> = {}) => ({
  id, label: id, type: layer === 'organization' ? 'Person' : layer === 'node' ? 'Laptop' : layer === 'network' ? 'CorpVLAN' : 'System', layer, citations: [], attrs: {}, ...extra,
})

/**
 * Network fixture (synthetic):
 *   x:out --email/none--> r:clerk (holder p:clerk, laptop dev:clerk in net:corp)
 *   net:corp --open--> net:prod --conditional--> net:pay (crown jewel sys:core)
 *   net:corp --blocked--> net:pay ; net:corp --conditional--> net:dmz (sys:web, high)
 *   shadow SaaS sys:rogue (oauth-grant) used by b:ops → syncs into net:corp
 */
function fixture(extra: Partial<MithDocument['model']> = {}): MithDocument {
  return parseMith({
    mith: '0.1', kind: 'document', id: 'net-fixture', title: 'net fixture', dataset_kind: 'synthetic-demo',
    generated_at: '2026-09-27T22:00:00+09:00', disclaimer: 'synthetic',
    model: {
      citations: [],
      entities: [
        ent('net:corp', 'network'), ent('net:prod', 'network'), ent('net:pay', 'network'), ent('net:dmz', 'network'),
        ent('p:clerk', 'organization', { boundary: 'b:ops', zone: 'net:corp' }),
        ent('dev:clerk', 'node', { boundary: 'b:ops', zone: 'net:corp', attrs: { owner: 'p:clerk' } }),
        ent('sys:ledger', 'server', { zone: 'net:prod', criticality: 'low' }),
        ent('sys:core', 'server', { zone: 'net:pay', criticality: 'crown-jewel' }),
        ent('sys:web', 'server', { zone: 'net:dmz', criticality: 'high' }),
        ent('sys:rogue', 'server', { zone: 'net:corp', sanctioned: false, source: 'oauth-grant', criticality: 'low' }),
      ],
      edges: [{ id: 'u1', source: 'b:ops', target: 'sys:rogue', kind: 'uses' }],
      boundaries: [{ id: 'b:co', label: 'Co', kind: 'company' }, { id: 'b:ops', label: 'Ops', kind: 'department', parent: 'b:co' }],
      roles: [{ id: 'r:clerk', label: 'Clerk', boundary: 'b:ops', holders: ['p:clerk'] }],
      grants: [{ id: 'g1', role: 'r:clerk', resource: 'sys:ledger', level: 'read' }],
      actors: [{ id: 'x:out', label: 'Outside (synthetic)', kind: 'external' }],
      channels: [{ id: 'c1', kind: 'email', from: 'x:out', to: 'r:clerk', verification: ['none'] }],
      reach: [
        { id: 'rc1', from: 'net:corp', to: 'net:prod', kind: 'open' },
        { id: 'rc2', from: 'net:prod', to: 'net:pay', kind: 'conditional' },
        { id: 'rc3', from: 'net:corp', to: 'net:pay', kind: 'blocked' },
        { id: 'rc4', from: 'net:corp', to: 'net:dmz', kind: 'conditional' },
      ],
      ...extra,
    },
    diagram: { arrangement: 'coplanar', camera: { mode: 'iso', tilt: 54, yaw: -28, zoom: 1, focusPlane: 'p' }, selection: null, planes: [{ id: 'p', layer: 'network', label: 'P', transform: { x: 0, y: 0, z: 0, tilt: 54, yaw: -28 }, placements: [] }], crossLinks: [] },
    inference: { viz_only: true, no_runners: true, hypotheses: [] },
  })
}

/** Same fixture without the shadow-SaaS `uses` edge (no internet entry), for pure org + network checks. */
const orgNet = (extra: Partial<MithDocument['model']> = {}) => fixture({ edges: [], ...extra })

const pathTo = (doc: MithDocument, target: string) => {
  const g = buildGraph(doc.model)
  const dj = dijkstra(g, Array.from({ length: g.nA }, (_, i) => i))
  return { hops: reconstruct(g, dj, g.index.get(target)!), cost: dj.dist[g.index.get(target)!]! }
}

describe('unified org + network graph', () => {
  it('walks actor → channel → role → device → zone → reach → zone → host → system', () => {
    const { hops, cost } = pathTo(orgNet(), 'sys:core')
    expect(hops.map((h) => h.to)).toEqual(['r:clerk', 'dev:clerk', 'net:corp', 'net:prod', 'net:pay', 'sys:core'])
    expect(hops.map((h) => h.edge)).toEqual([EDGE.channel, EDGE.pivot, EDGE.device, EDGE.reach, EDGE.reach, EDGE.host])
    expect(hops[1]!.kind).toBe('holder device')
    // channel 1 + pivot 1 + device 0 + open 1 + conditional 4 + host 1
    expect(cost).toBe(8)
    expect(hops.filter((h) => h.red).map((h) => h.ref)).toEqual(['c1', 'rc1'])
  })

  it('treats blocked reach as impassable (and a document may make it finite)', () => {
    const noDetour = orgNet({ reach: [{ id: 'rc3', from: 'net:corp', to: 'net:pay', kind: 'blocked' }] })
    expect(pathTo(noDetour, 'sys:core').hops).toEqual([])
    expect(analyzeExposure(noDetour.model).resources.find((r) => r.resource === 'sys:core')!.cost).toBeNull()
    const leaky = orgNet({ reach: [{ id: 'rc3', from: 'net:corp', to: 'net:pay', kind: 'blocked' }], weights: { reach: { blocked: 20 } } })
    expect(pathTo(leaky, 'sys:core').cost).toBe(1 + 1 + 0 + 20 + 1)
    // A per-edge weight overrides the kind default.
    const heavy = orgNet({ reach: [{ id: 'rc1', from: 'net:corp', to: 'net:prod', kind: 'open', weight: 3 }, { id: 'rc2', from: 'net:prod', to: 'net:pay', kind: 'conditional' }] })
    expect(pathTo(heavy, 'sys:core').cost).toBe(1 + 1 + 3 + 4 + 1)
  })

  it('applies per-document weight overrides to controls, reach, pivot and host', () => {
    const base = orgNet({ channels: [{ id: 'c1', kind: 'email', from: 'x:out', to: 'r:clerk', verification: ['callback'] }] })
    expect(pathTo(base, 'sys:core').cost).toBe(3 + 1 + 1 + 4 + 1)
    const tuned = orgNet({
      channels: [{ id: 'c1', kind: 'email', from: 'x:out', to: 'r:clerk', verification: ['callback'] }],
      weights: { controls: { callback: 7 }, reach: { conditional: 2 }, pivot: 0, host: 2 },
    })
    expect(pathTo(tuned, 'sys:core').cost).toBe(8 + 0 + 1 + 2 + 2)
  })

  it('counts weighted blast radius within the cost threshold, network hops included', () => {
    const doc = orgNet()
    // From the role: pivot 1 + open 1 + host 1 = 3 to the ledger zone; core costs 7.
    const r6 = blastRadius(doc, 'r:clerk')
    expect(r6.resources.map((x) => x.resource).sort()).toEqual(['sys:ledger', 'sys:web', 'sys:rogue'].sort())
    expect(r6.resources.find((x) => x.resource === 'sys:web')!.cost).toBe(1 + 4 + 1)
    const wide = blastRadius(doc, 'r:clerk', { maxCost: 7 })
    expect(wide.resources.find((x) => x.resource === 'sys:core')).toMatchObject({ level: 'network', cost: 7 })
    doc.model.weights = { blastRadius: 2 }
    // Grant (cost 0) plus the SaaS hosted in the clerk's own zone (pivot 1 + host 1).
    expect(blastRadius(doc, 'r:clerk').resources.map((x) => x.resource)).toEqual(['sys:ledger', 'sys:rogue'])
  })

  it('includes network cost in role score and flags network-reachable-without-grant systems', () => {
    const { report } = analyzeExposureGraph(orgNet().model)
    const clerk = report.roles.find((r) => r.role === 'r:clerk')!
    // Best: crown jewel over the network (value 8 × 0.6 = 4.8) at seize 1 + network 7 → 4.8 / 8.
    expect(clerk).toMatchObject({ viaNetwork: true, topResource: 'sys:core', topCost: 7, minCost: 1 })
    expect(clerk.score).toBe(Math.round((1000 * 4.8) / (8 * 8)) / 10)
    const core = report.networkExposures.find((x) => x.resource === 'sys:core')!
    expect(core).toMatchObject({ viaRole: 'r:clerk', hostZone: 'net:pay' })
    // Heavier conditional reach lowers the score; blocking the detour removes the network value.
    const heavier = analyzeExposure(orgNet({ weights: { reach: { conditional: 12 } } }).model).roles[0]!
    expect(heavier.score).toBeLessThan(clerk.score)
    const blocked = analyzeExposure(orgNet({ reach: [{ id: 'rc3', from: 'net:corp', to: 'net:pay', kind: 'blocked' }] }).model).roles[0]!
    expect(blocked.topResource).toBe('sys:ledger')
    expect(blocked.viaNetwork).toBe(false)
  })

  it('marks zones with an open-only path into a crown-jewel zone', () => {
    const open = analyzeExposure(fixture({ reach: [{ id: 'rc1', from: 'net:corp', to: 'net:prod', kind: 'open' }, { id: 'rc2', from: 'net:prod', to: 'net:pay', kind: 'open' }] }).model)
    expect(open.zones.find((z) => z.zone === 'net:corp')).toMatchObject({ openToCrownJewel: true, crownJewel: 'sys:core', crownJewelCost: 3 })
    expect(open.zones.find((z) => z.zone === 'net:pay')).toMatchObject({ hostsCrownJewel: true, openToCrownJewel: false })
    const cond = analyzeExposure(fixture().model)
    expect(cond.zones.find((z) => z.zone === 'net:corp')!.openToCrownJewel).toBe(false)
    expect(cond.totals.openToCrownJewelZones).toBe(0)
  })

  it('opens shadow-IT SaaS entry paths: internet → SaaS → sync into the users’ zone → reach', () => {
    const doc = fixture()
    const g = buildGraph(doc.model)
    expect(g.ids).toContain(INTERNET_ACTOR)
    const dj = dijkstra(g, [g.index.get(INTERNET_ACTOR)!])
    const hops = reconstruct(g, dj, g.index.get('sys:core')!)
    expect(hops.map((h) => h.edge)).toEqual([EDGE.entry, EDGE.sync, EDGE.reach, EDGE.reach, EDGE.host])
    // oauth-grant sync is open (cost 1): entry 1 + sync 1 + open 1 + conditional 4 + host 1
    expect(dj.dist[g.index.get('sys:core')!]).toBe(8)
    const report = analyzeExposure(doc.model)
    expect(report.shadowEntries[0]).toMatchObject({ system: 'sys:rogue', syncZones: 1, crownJewel: 'sys:core', crownJewelCost: 7 })
    // A shadow SaaS nobody uses opens no entry.
    const unused = analyzeExposure(fixture({ edges: [] }).model)
    expect(unused.shadowEntries[0]).toMatchObject({ syncZones: 0, crownJewelCost: null })
  })

  it('overrides the network-only value factor per document (default 0.6)', () => {
    expect(resolveWeights().networkValue).toBe(0.6)
    const base = analyzeExposure(orgNet().model)
    const core = (r: typeof base) => r.resources.find((x) => x.resource === 'sys:core')!
    const low = analyzeExposure(orgNet({ weights: { networkValue: 0.3 } }).model)
    expect(core(low).score).toBeCloseTo(core(base).score / 2, 1)
    // At 0.3 the crown jewel over the network (2.4 / 8) loses to the low read grant (0.4 / 1).
    expect(base.roles[0]!.topResource).toBe('sys:core')
    expect(low.roles[0]!.topResource).toBe('sys:ledger')
  })

  it('costs jump-host reach edges by weights.jumpHost (default 2); a per-edge weight still wins', () => {
    const jump = (weights?: MithDocument['model']['weights'], weight?: number) =>
      orgNet({ reach: [{ id: 'rc1', from: 'net:corp', to: 'net:pay', kind: 'conditional', jumpHost: true, ...(weight != null ? { weight } : {}) }], ...(weights ? { weights } : {}) })
    expect(pathTo(jump(), 'sys:core').cost).toBe(1 + 1 + 2 + 1)
    expect(pathTo(jump({ jumpHost: 6 }), 'sys:core').cost).toBe(1 + 1 + 6 + 1)
    expect(pathTo(jump({ jumpHost: 6 }, 3), 'sys:core').cost).toBe(1 + 1 + 3 + 1)
    // Blocked stays impassable even when marked as a jump host.
    expect(pathTo(orgNet({ reach: [{ id: 'rc1', from: 'net:corp', to: 'net:pay', kind: 'blocked', jumpHost: true }] }), 'sys:core').hops).toEqual([])
  })

  it('overrides shadow-SaaS sync costs; defaults follow the reach weights', () => {
    const inet = (doc: MithDocument) => {
      const g = buildGraph(doc.model)
      const dj = dijkstra(g, [g.index.get(INTERNET_ACTOR)!])
      return dj.dist[g.index.get('sys:core')!]
    }
    expect(inet(fixture())).toBe(1 + 1 + 1 + 4 + 1) // oauth-grant → open sync 1
    expect(inet(fixture({ weights: { sync: { open: 5 } } }))).toBe(1 + 5 + 1 + 4 + 1)
    expect(inet(fixture({ weights: { reach: { open: 2 } } }))).toBe(1 + 2 + 2 + 4 + 1)
    // A non-OAuth source syncs at the conditional cost.
    const sso = fixture({ weights: { sync: { conditional: 9 } } })
    sso.model.entities.find((e) => e.id === 'sys:rogue')!.source = 'sso-missing'
    expect(inet(sso)).toBe(1 + 9 + 1 + 4 + 1)
  })

  it('counts a shadow-SaaS crown-jewel path as a finding only within the blast-radius threshold', () => {
    // Cheapest SaaS → crown jewel cost is 7 (sync 1 + open 1 + conditional 4 + host 1).
    expect(analyzeExposure(fixture().model).totals.shadowToCrownJewel).toBe(0)
    expect(analyzeExposure(fixture({ weights: { blastRadius: 7 } }).model).totals.shadowToCrownJewel).toBe(1)
  })

  it('reads the tile-heat saturation per document (default 25 %)', () => {
    expect(resolveWeights().heatSaturation).toBe(0.25)
    expect(resolveWeights(orgNet({ weights: { heatSaturation: 0.5 } }).model.weights).heatSaturation).toBe(0.5)
  })

  it('rejects out-of-range or malformed weight overrides with clear errors', () => {
    const bad = (weights: unknown) => () => orgNet({ weights: weights as MithDocument['model']['weights'] })
    expect(bad({ networkValue: 1.5 })).toThrow(/model.weights.networkValue must be between 0 and 1/)
    expect(bad({ networkValue: -0.1 })).toThrow(MithParseError)
    expect(bad({ heatSaturation: 0 })).toThrow(/model.weights.heatSaturation must be above 0 and at most 1/)
    expect(bad({ heatSaturation: 1.2 })).toThrow(/heatSaturation/)
    expect(bad({ jumpHost: -1 })).toThrow(/model.weights.jumpHost must be 0 or more/)
    expect(bad({ sync: { blocked: 3 } })).toThrow(/model.weights.sync key/)
    expect(bad({ sync: { open: -2 } })).toThrow(/model.weights.sync.open must be 0 or more/)
    expect(bad({ sync: 4 })).toThrow(/model.weights.sync must be an object/)
    expect(bad({ networkvalue: 0.5 })).toThrow(/not a known weight/)
    expect(() => orgNet({ reach: [{ id: 'rc1', from: 'net:corp', to: 'net:pay', kind: 'open', jumpHost: 'yes' as never }] })).toThrow(/jumpHost must be true or false/)
    // Absent: defaults unchanged.
    expect(resolveWeights(orgNet().model.weights)).toMatchObject({ networkValue: 0.6, jumpHost: 2, sync: { open: 1, conditional: 4 }, heatSaturation: 0.25, blastRadius: 6 })
  })
})
