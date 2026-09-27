import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildGraph,
  DEFAULT_DEVICE_WEIGHTS,
  DEFAULT_MIN_RETENTION_DAYS,
  deviceRisk,
  dijkstra,
  logCoverage,
  reconstruct,
  resolveWeights,
} from '../src/graph'
import { parseMith } from '../src/parse'
import { readMithRaw } from '../src/twin'
import type { MithSoftware } from '../src/types'

const here = dirname(fileURLToPath(import.meta.url))
const orgText = readFileSync(resolve(here, '../samples/polaris-org.mith'), 'utf8')
const raw = (): ReturnType<typeof JSON.parse> => JSON.parse(JSON.stringify(readMithRaw(orgText)))
const dev = (d: ReturnType<typeof raw>, id: string) => d.model.entities.find((e: { id: string }) => e.id === id)

const sw = (over: Partial<MithSoftware>): MithSoftware => ({ name: 'x', version: '1', ...over })

describe('device software, logs, and people', () => {
  it('parses per-device software, logs, and users from the Form fixture', () => {
    const doc = parseMith(raw())
    const cfo = doc.model.entities.find((e) => e.id === 'dev:cfo')!
    expect(cfo.software?.some((s) => s.eol && s.vulnerability === 'high')).toBe(true)
    expect(cfo.logs).toMatchObject({ forwardTo: 'siem', retentionDays: 90 })
    expect(cfo.logs?.events?.length).toBe(2)
    expect(cfo.users?.map((u) => u.relation)).toEqual(['primary', 'user', 'admin'])
  })

  it('validates device fields', () => {
    const bad = (mut: (d: ReturnType<typeof raw>) => void) => {
      const d = raw()
      mut(d)
      return () => parseMith(d)
    }
    expect(bad((d) => { dev(d, 'dev:cfo').users.push({ person: 'p:ap1', relation: 'primary' }) })).toThrow(/primary users/)
    expect(bad((d) => { dev(d, 'dev:cfo').users.push({ person: 'p:ea', relation: 'admin' }) })).toThrow(/twice/)
    expect(bad((d) => { dev(d, 'dev:ap1').users = [{ person: 'p:cfo', relation: 'primary' }] })).toThrow(/differs from attrs.owner/)
    expect(bad((d) => { dev(d, 'dev:cfo').users.push({ person: 'p:nobody', relation: 'user' }) })).toThrow(/not in model.entities/)
    expect(bad((d) => { dev(d, 'dev:cfo').logs.retentionDays = 5000 })).toThrow(/0 to 3650/)
    expect(bad((d) => { dev(d, 'dev:cfo').logs.forwardTo = 'https://example.invalid' })).toThrow(/destination id/)
    expect(bad((d) => { dev(d, 'dev:cfo').logs.sources = ['edr', 'edr'] })).toThrow(/twice/)
    expect(bad((d) => { dev(d, 'dev:cfo').logs.events[0].at = 'yesterday' })).toThrow(/ISO 8601/)
    expect(bad((d) => { dev(d, 'dev:cfo').logs.events = Array.from({ length: 51 }, () => dev(d, 'dev:cfo').logs.events[0]) })).toThrow(/at most 50/)
    expect(bad((d) => { dev(d, 'dev:cfo').software[0].vulnerability = 'catastrophic' })).toThrow(/must be one of/)
    expect(bad((d) => { dev(d, 'sys:erp').software = [] })).toThrow(/only allowed on node-layer devices/)
  })

  it('validates the new weights (defaults, ranges, unknown keys)', () => {
    const w = (weights: unknown) => () => parseMith({ ...raw(), model: { ...raw().model, weights } })
    expect(w({ device: { eol: 0.4, vulnerability: { critical: 0.5 }, maxEase: 0.9 }, minRetentionDays: 60 })).not.toThrow()
    expect(w({ device: { eol: 1.5 } })).toThrow(/eol/)
    expect(w({ device: { eol: -0.1 } })).toThrow(/eol/)
    expect(w({ device: { patchLag: 0.1 } })).toThrow(/not a known weight/)
    expect(w({ device: { vulnerability: { none: 0.1 } } })).toThrow(/vulnerability key/)
    expect(w({ minRetentionDays: 0 })).toThrow(/1 to 3650/)
    expect(w({ minRetentionDays: 7.5 })).toThrow(/1 to 3650/)
    const r = resolveWeights(undefined)
    expect(r.device).toEqual({ ...DEFAULT_DEVICE_WEIGHTS, vulnerability: { ...DEFAULT_DEVICE_WEIGHTS.vulnerability } })
    expect(r.minRetentionDays).toBe(DEFAULT_MIN_RETENTION_DAYS)
    expect(resolveWeights({ device: { vulnerability: { high: 0.2 } } }).device.vulnerability).toMatchObject({ high: 0.2, critical: 0.45 })
  })
})

describe('light device scoring', () => {
  const w = resolveWeights(undefined).device
  it('EOL / unsanctioned / worst vulnerability raise compromise ease, capped at maxEase', () => {
    expect(deviceRisk(undefined, w).ease).toBe(0)
    expect(deviceRisk([sw({ vulnerability: 'low' })], w).ease).toBeCloseTo(0.05)
    expect(deviceRisk([sw({ eol: true, vulnerability: 'high' })], w).ease).toBeCloseTo(0.6)
    expect(deviceRisk([sw({ sanctioned: false, vulnerability: 'medium' }), sw({ vulnerability: 'low' })], w).ease).toBeCloseTo(0.3)
    expect(deviceRisk([sw({ eol: true, sanctioned: false, vulnerability: 'critical' })], w).ease).toBe(0.8)
    expect(deviceRisk([sw({ eol: true, name: 'PDF viewer', version: '9.1' })], w).reasons).toEqual(['EOL: PDF viewer 9.1'])
  })

  it('classifies log coverage; absent logs are unknown, not a blind spot', () => {
    expect(logCoverage(undefined, 30)).toBe('unknown')
    expect(logCoverage({ sources: ['edr'], forwardTo: 'none', retentionDays: 90 }, 30)).toBe('blind')
    expect(logCoverage({ sources: [], forwardTo: 'siem', retentionDays: 90 }, 30)).toBe('blind')
    expect(logCoverage({ sources: ['edr'], forwardTo: 'siem', retentionDays: 14 }, 30)).toBe('short')
    expect(logCoverage({ sources: ['edr'], forwardTo: 'siem', retentionDays: 30 }, 30)).toBe('forwarded')
  })

  it('makes the role → device pivot cheaper by ease (pivot × (1 − ease))', () => {
    const doc = parseMith(raw())
    const g = buildGraph(doc.model)
    const ri = g.index.get('role:cfo')!
    const entry = g.roleZones.get(ri)!.find((x) => g.ids[x.device] === 'dev:cfo')!
    expect(entry.cost).toBeCloseTo(0.4) // EOL (0.3) + high vuln (0.3) → ease 0.6
    // A linked admin can stand on the device too: IAM admin → treasury laptop (EOL + critical, ease 0.75).
    const iam = g.roleZones.get(g.index.get('role:iam-admin')!)!
    expect(iam.some((x) => g.ids[x.device] === 'dev:treasury1' && Math.abs(x.cost - 0.25) < 1e-9)).toBe(true)
  })

  it('flags detection blind spots on path hops without changing reachability or cost', () => {
    const d = raw()
    const g = buildGraph(parseMith(d).model)
    const ri = g.index.get('role:servicedesk')!
    const zone = g.index.get(dev(d, 'dev:sd1').zone)!
    const hops = reconstruct(g, dijkstra(g, [ri]), zone)
    const onDevice = hops.find((h) => h.to === 'dev:sd1')!
    expect(onDevice.blind).toBe('blind')
    expect(onDevice.notes?.some((n) => /blind spot/.test(n))).toBe(true)
    expect(onDevice.notes?.some((n) => /device ease 0\.45/.test(n))).toBe(true)
    // Same graph without the logs block: identical costs, no flag.
    delete dev(d, 'dev:sd1').logs
    const g2 = buildGraph(parseMith(d).model)
    const dj1 = dijkstra(g, [ri])
    const dj2 = dijkstra(g2, [g2.index.get('role:servicedesk')!])
    expect(Array.from(dj2.dist)).toEqual(Array.from(dj1.dist))
    const hops2 = reconstruct(g2, dj2, g2.index.get(dev(d, 'dev:sd1').zone)!)
    expect(hops2.find((h) => h.to === 'dev:sd1')?.blind).toBeUndefined()
    // Short retention is its own flag.
    const tHops = reconstruct(g, dijkstra(g, [g.index.get('role:treasury-approver')!]), g.index.get('net:pay')!)
    expect(tHops.find((h) => h.to === 'dev:treasury1')?.blind).toBe('short')
  })
})
