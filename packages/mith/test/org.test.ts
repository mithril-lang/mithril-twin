import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { lensLayout } from '../src/lensLayout'
import { lensFocus } from '../src/lensLinks'
import { blastRadius, impersonationPaths, roleExposure, shadowSystems } from '../src/org'
import { parseMith } from '../src/parse'
import { analyzeExposure, CONTROL_WEIGHTS, effectiveCriticality, hopCost } from '../src/exposure'
import { readMith } from '../src/twin'

const here = dirname(fileURLToPath(import.meta.url))
const orgSample = readMith(readFileSync(resolve(here, '../samples/polaris-org.mith'), 'utf8')).doc

const ent = (id: string, layer = 'server', extra: Record<string, unknown> = {}) => ({
  id, label: id, type: layer === 'organization' ? 'Person' : 'System', layer, citations: [], attrs: {}, ...extra,
})

/** Small synthetic fixture: A → B unverified, B → C verified, B → D unverified, D → A (cycle). */
const fixture = parseMith({
  mith: '0.1',
  kind: 'document',
  id: 'fixture',
  title: 'fixture',
  dataset_kind: 'synthetic-demo',
  generated_at: '2026-09-27T20:00:00+09:00',
  disclaimer: 'synthetic',
  model: {
    citations: [],
    entities: [
      ent('p:a', 'organization', { boundary: 'b:co' }),
      ent('sys:ledger', 'server', { boundary: 'b:co' }),
      ent('sys:pay', 'server', { boundary: 'b:team' }),
      ent('sys:idp', 'server', { boundary: 'b:team' }),
      ent('sys:rogue', 'server', { sanctioned: false, source: 'oauth-grant' }),
    ],
    edges: [
      { id: 'u1', source: 'p:a', target: 'sys:rogue', kind: 'uses' },
      { id: 'u2', source: 'b:team', target: 'sys:rogue', kind: 'uses' },
    ],
    boundaries: [
      { id: 'b:co', label: 'Co', kind: 'company' },
      { id: 'b:dept', label: 'Dept', kind: 'department', parent: 'b:co' },
      { id: 'b:team', label: 'Team', kind: 'team', parent: 'b:dept' },
    ],
    roles: [
      { id: 'r:a', label: 'A', boundary: 'b:co', holders: ['p:a'] },
      { id: 'r:b', label: 'B', boundary: 'b:dept', holders: [] },
      { id: 'r:c', label: 'C', boundary: 'b:team', holders: [] },
      { id: 'r:d', label: 'D', boundary: 'b:team', holders: [] },
    ],
    grants: [
      { id: 'g1', role: 'r:a', resource: 'sys:ledger', level: 'read' },
      { id: 'g2', role: 'r:b', resource: 'sys:ledger', level: 'approve' },
      { id: 'g3', role: 'r:c', resource: 'sys:pay', level: 'admin' },
      { id: 'g4', role: 'r:d', resource: 'sys:idp', level: 'admin' },
      { id: 'g5', role: 'r:d', resource: 'sys:ledger', level: 'read' },
    ],
    actors: [{ id: 'x:out', label: 'Outside (synthetic)', kind: 'external' }],
    channels: [
      { id: 'c1', kind: 'email', from: 'x:out', to: 'r:a', verification: ['none'] },
      { id: 'c2', kind: 'chat', from: 'r:a', to: 'r:b', verification: [] },
      { id: 'c3', kind: 'helpdesk', from: 'r:b', to: 'r:c', verification: ['callback'] },
      { id: 'c4', kind: 'chat', from: 'r:b', to: 'r:d', verification: ['none'] },
      { id: 'c5', kind: 'chat', from: 'r:d', to: 'r:a', verification: ['none'] },
      { id: 'c6', kind: 'phone', from: 'x:out', to: 'r:c', verification: ['mfa', 'none'] },
    ],
  },
  diagram: {
    arrangement: 'coplanar',
    camera: { mode: 'iso', tilt: 54, yaw: -28, zoom: 1, focusPlane: 'plane:one' },
    selection: null,
    planes: [{ id: 'plane:one', layer: 'server', label: 'One', transform: { x: 0, y: 0, z: 0, tilt: 54, yaw: -28 }, placements: [] }],
    crossLinks: [],
  },
  inference: { viz_only: true, no_runners: true, hypotheses: [] },
})

describe('blast radius', () => {
  it('uses weighted reach: weak controls count, within the cost threshold', () => {
    const r = blastRadius(fixture, 'r:a')
    const byResource = Object.fromEntries(r.resources.map((x) => [x.resource, x]))
    // Direct read on the ledger is upgraded to approve via B (c2 has no control, cost 1).
    expect(byResource['sys:ledger']).toMatchObject({ level: 'approve', via: ['r:a', 'r:b'], channels: ['c2'], cost: 1 })
    // D is reachable A → B → D, both unverified (cost 2).
    expect(byResource['sys:idp']).toMatchObject({ level: 'admin', via: ['r:a', 'r:b', 'r:d'], cost: 2 })
    // C sits behind a callback (c3, cost 3): 1 + 3 = 4 ≤ default threshold 6, so a weak control
    // no longer hides C's admin grant on pay.
    expect(byResource['sys:pay']).toMatchObject({ level: 'admin', via: ['r:a', 'r:b', 'r:c'], cost: 4 })
    expect(r.counts).toEqual({ read: 0, approve: 1, admin: 2 })
    expect(r.maxLevel).toBe('admin')
  })

  it('drops resources beyond the threshold (option or per-document weight)', () => {
    // Threshold 3 keeps the unverified hops (≤ 2) but not the callback hop (cost 4).
    const tight = blastRadius(fixture, 'r:a', { maxCost: 3 })
    expect(tight.resources.map((x) => x.resource).sort()).toEqual(['sys:idp', 'sys:ledger'])
    const doc = structuredClone(fixture)
    doc.model.weights = { blastRadius: 3 }
    expect(blastRadius(doc, 'r:a').resources.some((x) => x.resource === 'sys:pay')).toBe(false)
    // Raising the callback weight also pushes C out, via the per-document control override.
    const heavy = structuredClone(fixture)
    heavy.model.weights = { controls: { callback: 20 } }
    expect(blastRadius(heavy, 'r:a').resources.some((x) => x.resource === 'sys:pay')).toBe(false)
  })

  it('can be limited to direct grants, and is empty for an unknown role', () => {
    const direct = blastRadius(fixture, 'r:a', { lateral: false })
    expect(direct.resources.map((x) => `${x.resource}:${x.level}`)).toEqual(['sys:ledger:read'])
    expect(blastRadius(fixture, 'r:ghost').resources).toEqual([])
    expect(blastRadius(fixture, 'r:ghost').maxLevel).toBeNull()
  })

  it('measures the synthetic sample: AP clerk reaches treasury approvals over unverified chat', () => {
    const r = blastRadius(orgSample, 'role:ap-clerk')
    const portal = r.resources.find((x) => x.resource === 'sys:bank-portal')
    expect(portal).toMatchObject({ level: 'approve', via: ['role:ap-clerk', 'role:treasury-clerk', 'role:treasury-approver'] })
    expect(blastRadius(orgSample, 'role:servicedesk').resources.find((x) => x.resource === 'sys:idp')?.level).toBe('admin')
  })
})

describe('impersonation paths', () => {
  it('enumerates simple paths from actors and flags hops without a control', () => {
    const paths = impersonationPaths(fixture)
    const summary = paths.map((p) => `${p.nodes.join('>')}:${p.unverified ? 'U' : 'V'}`)
    expect(summary).toEqual([
      'x:out>r:a:U',
      'x:out>r:a>r:b:U',
      'x:out>r:a>r:b>r:d:U',
      'x:out>r:c:V',
      'x:out>r:a>r:b>r:c:V',
    ])
    // The D → A back edge never revisits A.
    expect(paths.every((p) => new Set(p.nodes).size === p.nodes.length)).toBe(true)
    expect(impersonationPaths(fixture, { maxHops: 2 }).every((p) => p.hops <= 2)).toBe(true)
  })

  it('reports unverified count and min hops per role, high-value first', () => {
    const exposure = Object.fromEntries(roleExposure(fixture).map((x) => [x.role, x]))
    expect(exposure['r:d']).toMatchObject({ highValue: true, paths: 1, unverifiedPaths: 1, minHops: 3, minUnverifiedHops: 3 })
    // A control on either hop (mfa on c6, callback on c3) makes both paths into C verified.
    expect(exposure['r:c']).toMatchObject({ highValue: true, paths: 2, unverifiedPaths: 0, minHops: 1, minUnverifiedHops: null })
    expect(exposure['r:a']).toMatchObject({ highValue: false, unverifiedPaths: 1, minHops: 1 })
    expect(roleExposure(fixture)[0]?.highValue).toBe(true)
  })

  it('measures the synthetic sample', () => {
    const paths = impersonationPaths(orgSample)
    expect(paths.filter((p) => p.unverified)).toHaveLength(7)
    expect(paths).toHaveLength(15)
    const approver = roleExposure(orgSample).find((x) => x.role === 'role:treasury-approver')!
    expect(approver).toMatchObject({ unverifiedPaths: 1, minHops: 2, minUnverifiedHops: 3 })
    const cfo = roleExposure(orgSample).find((x) => x.role === 'role:cfo')!
    expect(cfo).toMatchObject({ highValue: true, paths: 0, minHops: null })
  })

  it('draws red links only for hops without a control', () => {
    const { links } = lensFocus(fixture, 'impersonation', null)
    const red = links.filter((l) => l.cls === 'channel-unverified').map((l) => l.id).sort()
    expect(red).toEqual(['channel:c1', 'channel:c2', 'channel:c4', 'channel:c5'])
  })
})

describe('shadow IT and lens layout', () => {
  it('lists unsanctioned systems with their users', () => {
    expect(shadowSystems(fixture)).toEqual([
      expect.objectContaining({ source: 'oauth-grant', usedBy: ['p:a', 'b:team'] }),
    ])
  })

  it('nests org frames and keeps unsanctioned systems outside the company frame', () => {
    const layout = lensLayout(fixture, 'org', 'org')
    const frame = (id: string) => layout.frames.find((f) => f.id === id)!
    const inside = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
      a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h
    expect(inside(frame('b:team'), frame('b:dept'))).toBe(true)
    expect(inside(frame('b:dept'), frame('b:co'))).toBe(true)
    expect(frame('b:team').depth).toBe(2)
    const shadow = frame('shadow:sys:rogue')
    expect(shadow.dashed).toBe(true)
    expect(shadow.x).toBeGreaterThanOrEqual(frame('b:co').x + frame('b:co').w)
    const pay = layout.items.find((i) => i.id === 'sys:pay')!
    expect(pay.frame).toBe('b:team')
    // Roles only join the grid on the Access and Impersonation lenses.
    expect(layout.items.some((i) => i.kind === 'role')).toBe(false)
    expect(lensLayout(fixture, 'access', 'org').items.filter((i) => i.kind === 'role')).toHaveLength(4)
    expect(lensLayout(fixture, 'impersonation', 'org').frames.some((f) => f.kind === 'external')).toBe(true)
  })

  it('frames the same objects by network zone, nesting zones by their own zone', () => {
    const layout = lensLayout(orgSample, 'network', 'network')
    const transit = layout.frames.find((f) => f.id === 'net:transit')!
    const pay = layout.frames.find((f) => f.id === 'net:pay')!
    expect(pay.depth).toBe(transit.depth + 1)
    expect(layout.items.find((i) => i.id === 'p:ap1')?.frame).toBe('net:pay')
    expect(layout.items.find((i) => i.id === 'sys:shadow-esign')).toMatchObject({ frame: 'net:inet', kind: 'shadow' })
    expect(layout.frames.some((f) => f.kind === 'company')).toBe(false)
  })
})

describe('weighted exposure (weak controls count)', () => {
  it('orders hop costs none < callback < mfa < dual-approval and adds combinations', () => {
    const c = (verification: string[]) => hopCost({ verification: verification as never })
    expect(c(['none'])).toBe(1)
    expect(c([])).toBe(1)
    expect(c(['callback'])).toBe(1 + CONTROL_WEIGHTS.callback)
    expect(c(['none'])).toBeLessThan(c(['callback']))
    expect(c(['callback'])).toBeLessThan(c(['mfa']))
    expect(c(['mfa'])).toBeLessThan(c(['dual-approval']))
    expect(c(['callback', 'mfa'])).toBe(1 + CONTROL_WEIGHTS.callback + CONTROL_WEIGHTS.mfa)
    expect(c(['mfa', 'mfa'])).toBe(c(['mfa']))
  })

  it('finds the min-cost path even when it has more hops, and keeps min hops / unverified counts', () => {
    const report = analyzeExposure(fixture.model)
    const c = report.roles.find((r) => r.role === 'r:c')!
    // Direct phone hop has mfa (cost 6). The 3-hop route costs 1 + 1 + 3 (callback) = 5.
    expect(c.easiest).toMatchObject({ nodes: ['x:out', 'r:a', 'r:b', 'r:c'], channels: ['c1', 'c2', 'c3'], cost: 5 })
    expect(c).toMatchObject({ minHops: 1, unverifiedPaths: 0, paths: 2, minCost: 5 })
    // No criticality in the fixture: admin falls back to high (4) × level 1 → 100 × (1/5) × 4 / 8.
    expect(c.score).toBe(10)
    expect(report.totals).toMatchObject({ paths: 5, unverifiedPaths: 3, capped: false })
  })

  it('uses criticality instead of the approve/admin rule when present', () => {
    expect(effectiveCriticality('admin')).toBe('high')
    expect(effectiveCriticality('read')).toBe('medium')
    expect(effectiveCriticality('read', 'crown-jewel')).toBe('crown-jewel')
    const doc = structuredClone(fixture)
    doc.model.entities.find((e) => e.id === 'sys:ledger')!.criticality = 'crown-jewel'
    doc.model.entities.find((e) => e.id === 'sys:idp')!.criticality = 'low'
    doc.model.entities.find((e) => e.id === 'sys:pay')!.criticality = 'low'
    const byRole = Object.fromEntries(roleExposure(doc).map((x) => [x.role, x]))
    // A read on a crown-jewel is high-value; admin on a low system is not.
    expect(byRole['r:a']?.highValue).toBe(true)
    expect(byRole['r:c']?.highValue).toBe(false)
    const report = analyzeExposure(doc.model)
    expect(report.resources[0]).toMatchObject({ resource: 'sys:ledger', criticality: 'crown-jewel', declared: true })
  })

  it('ranks the synthetic org sample by exposure score', () => {
    const report = analyzeExposure(orgSample.model)
    expect(report.roles[0]).toMatchObject({ role: 'role:servicedesk', score: 80, minCost: 1 })
    const approver = report.roles.find((r) => r.role === 'role:treasury-approver')!
    // Two hops exist but carry a control; the cheapest route is three unverified hops.
    expect(approver).toMatchObject({ minHops: 2, minCost: 3, unverifiedPaths: 1 })
    expect(approver.easiest?.nodes).toEqual(['actor:ext-sender', 'role:ap-clerk', 'role:treasury-clerk', 'role:treasury-approver'])
    expect(report.resources[0]).toMatchObject({ resource: 'sys:idp', criticality: 'crown-jewel', viaRole: 'role:servicedesk' })
    expect(report.roles.find((r) => r.role === 'role:cfo')).toMatchObject({ score: 0, minCost: null, easiest: null })
  })
})
