import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseMith } from '../mith/parse'
import { analyzeScale, parseManifest } from './model'
import { enterpriseFiles, generateEnterprise, TARGETS } from './generate'
import { expandChunk, type PackChunk } from './pack'

const files = enterpriseFiles()

describe('enterprise generator (synthetic, seeded)', () => {
  it('is deterministic for a seed and differs for another', () => {
    const hash = (m: Map<string, string>) => createHash('sha256').update([...m].map(([k, v]) => `${k}\n${v}`).join('\n')).digest('hex')
    expect(hash(enterpriseFiles())).toBe(hash(files))
    expect(hash(enterpriseFiles(7))).not.toBe(hash(files))
  })

  it('hits the target scale', () => {
    const m = parseManifest(JSON.parse(files.get('manifest.json')!))
    expect(m.counts).toMatchObject({
      subsidiaries: TARGETS.subsidiaries,
      departments: TARGETS.departments,
      employees: TARGETS.employees,
      systems: TARGETS.systems,
      unsanctioned: TARGETS.unsanctioned,
    })
    expect(m.counts.devices).toBeGreaterThan(65_000)
    expect(m.counts.devices).toBeLessThan(75_000)
    expect(m.companies).toHaveLength(300)
    expect(files.size).toBe(302)
    expect(m.companies.reduce((a, c) => a + c.people, 0)).toBe(50_000)
  })

  it('writes an index that parseMith accepts, with criticality and channel controls', () => {
    const doc = parseMith(JSON.parse(files.get('index.mith')!))
    expect(doc.dataset_kind).toBe('synthetic-demo')
    expect(doc.model.actors?.every((a) => /synthetic/.test(a.label))).toBe(true)
    const systems = doc.model.entities.filter((e) => e.layer === 'server')
    expect(systems).toHaveLength(1500)
    expect(systems.filter((s) => s.criticality === 'crown-jewel').length).toBeGreaterThan(100)
    // A few legacy records keep no criticality so the level fallback is exercised.
    expect(systems.some((s) => !s.criticality)).toBe(true)
    const controls = new Set(doc.model.channels!.flatMap((c) => c.verification))
    expect([...controls].sort()).toEqual(['callback', 'dual-approval', 'mfa', 'none'])
    // Only one representative holder (+ laptop) per role is in the index; the rest stay in chunks.
    const people = doc.model.entities.filter((e) => e.type === 'Person')
    expect(people.length).toBeLessThanOrEqual(doc.model.roles!.length)
    expect(people.every((p) => p.attrs.representative === 'true')).toBe(true)
    expect(doc.model.roles!.every((r) => r.holders.length === 1 && r.zone)).toBe(true)
  })

  it('expands a company chunk into ordinary entities', () => {
    const chunk = JSON.parse(files.get('companies/s002.json')!) as PackChunk
    const x = expandChunk(chunk)
    expect(x.people.length).toBe(chunk.people.team.length)
    expect(x.people[0]).toMatchObject({ type: 'Person', layer: 'organization', id: 's002.p0' })
    expect(x.devices.every((d) => d.boundary?.startsWith('b:s002.d'))).toBe(true)
    expect([...x.holders.values()].flat().every((id) => id.startsWith('s002.p'))).toBe(true)
    expect(() => expandChunk({ ...chunk, dataset_kind: 'live' as never })).toThrow(/synthetic-demo/)
  })

  it('stays compact in memory (generated in the browser, never shipped)', () => {
    let raw = 0
    let gz = 0
    for (const [, body] of files) {
      raw += body.length
      gz += gzipSync(body).length
    }
    expect(files.get('index.mith')!.length).toBeLessThan(5_000_000)
    expect(raw).toBeLessThan(8_000_000)
    expect(gz).toBeLessThan(1_300_000)
  })

  it('aggregates exposure per subsidiary and department', () => {
    const a = analyzeScale(parseMith(generateEnterprise().index))
    expect(Object.keys(a.companyHeat).length).toBeGreaterThan(250)
    expect(a.report.totals.capped).toBe(false)
    expect(a.report.roles[0]!.score).toBeGreaterThan(0)
    expect(a.shadowApps).toHaveLength(150)
  })

  it('segments every subsidiary (corp / prod / DMZ / OT / payments) with seeded misconfigurations', () => {
    const { manifest, index } = generateEnterprise()
    const doc = parseMith(index)
    const reach = doc.model.reach!
    expect(reach.length).toBe(manifest.counts.reach)
    const kinds = new Set(reach.map((r) => r.kind))
    expect([...kinds].sort()).toEqual(['blocked', 'conditional', 'open'])
    // Open reach is rare and every open edge is a seeded misconfiguration.
    expect(manifest.counts.openReach).toBe(manifest.counts.misconfigured)
    expect(manifest.counts.openReach).toBeGreaterThan(10)
    expect(manifest.counts.openReach).toBeLessThan(reach.length * 0.05)
    const zones = new Set(doc.model.entities.filter((e) => e.layer === 'network').map((e) => e.id))
    expect(zones.has('net:s002.prod') && zones.has('net:s002.dmz') && zones.has('net:s002.ot') && zones.has('net:s002.pay')).toBe(true)
    expect(zones.has('net:transit')).toBe(true)
    // Crown-jewel group systems sit in segmented group zones, not the flat data center.
    expect(doc.model.entities.find((e) => e.id === 'sys:g.swift')?.zone).toBe('net:gcore')
    // Devices in the index belong to representative holders and sit in a zone.
    expect(doc.model.entities.filter((e) => e.layer === 'node').every((d) => d.zone && d.attrs.owner)).toBe(true)
  })

  it('scores mixed org + network paths and flags open paths into crown-jewel zones', () => {
    const a = analyzeScale(parseMith(generateEnterprise().index))
    const r = a.report
    expect(r.roles.some((x) => x.viaNetwork && x.score > 0 && x.topCost > 0)).toBe(true)
    expect(r.totals.openToCrownJewelZones).toBeGreaterThan(0)
    expect(r.totals.networkOnlySystems).toBeGreaterThan(0)
    expect(r.shadowEntries.some((x) => x.syncZones > 0 && x.crownJewelCost != null)).toBe(true)
    // Heat = share of roles ≥ 50 per tile.
    const h = Object.values(a.companyHeat)
    expect(h.every((x) => x.share === x.hot / x.roles)).toBe(true)
    expect(h.some((x) => x.share > 0 && x.share < 1)).toBe(true)
  })
})
