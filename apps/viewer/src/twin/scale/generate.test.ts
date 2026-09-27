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
    // People and devices are not in the index.
    expect(doc.model.entities.some((e) => e.type === 'Person')).toBe(false)
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

  it('stays compact: no multi-megabyte blob per file', () => {
    let raw = 0
    let gz = 0
    for (const [, body] of files) {
      raw += body.length
      gz += gzipSync(body).length
    }
    expect(files.get('index.mith')!.length).toBeLessThan(3_000_000)
    expect(raw).toBeLessThan(6_000_000)
    expect(gz).toBeLessThan(900_000)
  })

  it('aggregates exposure per subsidiary and department', () => {
    const a = analyzeScale(parseMith(generateEnterprise().index))
    expect(Object.keys(a.companyHeat).length).toBeGreaterThan(250)
    expect(a.report.totals.capped).toBe(false)
    expect(a.report.roles[0]!.score).toBeGreaterThan(0)
    expect(a.shadowApps).toHaveLength(150)
  })
})
