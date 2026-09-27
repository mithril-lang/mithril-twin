import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AttackPathsOverlay, LayerData } from '../src/layers'
import { fromLayers } from '../src/fromLayers'
import { boardForEntity, coplanarFloor, COPLANAR_BOARD_H, COPLANAR_BOARD_W, crossArcPath, fitBoardsInSafeArea, visiblePlanes, windowStart } from '../src/geometry'
import { MithParseError, parseMith, parseMithrilPackage } from '../src/parse'
import { hasOrgModel } from '../src/org'
import type { MithPlane } from '../src/types'

const here = dirname(fileURLToPath(import.meta.url))
const sample = JSON.parse(readFileSync(resolve(here, '../samples/polaris-fi.mith'), 'utf8'))
const floorSample = JSON.parse(readFileSync(resolve(here, '../samples/polaris-floor.mith'), 'utf8'))
const legacySample = JSON.parse(readFileSync(resolve(here, 'fixtures/polaris-fi.v0-stacked.mith'), 'utf8'))
const pack = JSON.parse(readFileSync(resolve(here, '../samples/polaris-fi.mithril'), 'utf8'))
const orgSample = JSON.parse(readFileSync(resolve(here, '../samples/polaris-org.mith'), 'utf8'))

describe('parseMith', () => {
  it('loads the committed synthetic-demo sample', () => {
    const doc = parseMith(sample)
    expect(doc.dataset_kind).toBe('synthetic-demo')
    expect(doc.diagram.arrangement).toBe('coplanar')
    expect(doc.diagram.camera.focusPlane).toBe('plane:network')
    expect(doc.diagram.selection).toBe('net:polaris-bank-core-01-corp')
    expect(doc.inference.viz_only).toBe(true)
    expect(doc.inference.no_runners).toBe(true)
    expect(doc.inference.hypotheses.every((h) => h.honesty === 'hypothesis' && h.observation_count === 0)).toBe(true)
    expect(doc.model.entities.length).toBeGreaterThan(5)
    expect(doc.diagram.planes).toHaveLength(5)
    expect(new Set(doc.diagram.planes.map((p) => p.transform.z))).toEqual(new Set([0]))
    const xs = doc.diagram.planes.map((p) => p.transform.x)
    expect(new Set(xs).size).toBe(xs.length)
  })

  it('loads the tiny coplanar floor and infers coplanar when z is shared', () => {
    const floor = parseMith(floorSample)
    expect(floor.diagram.arrangement).toBe('coplanar')
    expect(floor.diagram.planes).toHaveLength(2)
    expect(floor.diagram.planes[0]?.transform.z).toBe(floor.diagram.planes[1]?.transform.z)
    expect(floor.diagram.planes[0]?.transform.x).not.toBe(floor.diagram.planes[1]?.transform.x)

    const copy = structuredClone(sample)
    delete copy.diagram.arrangement
    expect(parseMith(copy).diagram.arrangement).toBe('coplanar')
  })

  it('loads the original stacked v0 polaris-fi.mith, which omits arrangement and stairs on z', () => {
    expect(legacySample.diagram.arrangement).toBeUndefined()
    expect(legacySample.mith).toBe('0.1')
    const doc = parseMith(legacySample)
    expect(doc.diagram.arrangement).toBe('stacked')
    expect(doc.diagram.planes.map((p) => p.id)).toEqual([
      'plane:organization',
      'plane:network',
      'plane:firewall',
      'plane:node',
      'plane:server',
    ])
    expect(doc.diagram.planes.map((p) => p.transform.z)).toEqual([180, 90, 0, -90, -180])
    expect(doc.diagram.selection).toBe('net:polaris-bank-core-01-corp')
  })

  it('explains coplanar z and overlap mistakes, and a stacked floor that forgot distinct z', () => {
    const differentZ = structuredClone(sample)
    differentZ.diagram.planes[0].transform.z = 180
    expect(() => parseMith(differentZ)).toThrow(/shared transform\.z/)
    expect(() => parseMith(differentZ)).toThrow(/plane:organization z=180/)

    const piled = structuredClone(sample)
    for (const plane of piled.diagram.planes) {
      plane.transform.x = 0
      plane.transform.y = 0
      plane.transform.z = 0
    }
    expect(() => parseMith(piled)).toThrow(/280×176/)
    expect(() => parseMith(piled)).toThrow(/plane:organization at \(0, 0\) overlaps/)

    const partial = structuredClone(sample)
    for (const [i, plane] of partial.diagram.planes.entries()) {
      plane.transform.x = i * (COPLANAR_BOARD_W + 40)
      plane.transform.y = 0
      plane.transform.z = 0
    }
    partial.diagram.planes[1].transform.x = COPLANAR_BOARD_W - 40
    expect(() => parseMith(partial)).toThrow(/overlaps/)

    const touching = structuredClone(sample)
    for (const [i, plane] of touching.diagram.planes.entries()) {
      plane.transform.x = i * COPLANAR_BOARD_W
      plane.transform.y = 0
      plane.transform.z = 0
    }
    expect(() => parseMith(touching)).not.toThrow()

    const flatStack = structuredClone(sample)
    flatStack.diagram.arrangement = 'stacked'
    expect(() => parseMith(flatStack)).toThrow(/distinct transform\.z/)
  })

  it('rejects a bad version, a non-synthetic dataset, and runner keys', () => {
    expect(() => parseMith({ ...sample, mith: '9' })).toThrow(MithParseError)
    expect(() => parseMith({ ...sample, dataset_kind: 'live' })).toThrow(/synthetic-demo/)
    expect(() => parseMith({ ...sample, runner: 'nope' })).toThrow(/not allowed/)
  })
})

describe('org sections (boundaries, roles, grants, actors, channels)', () => {
  const baseEntityKeys = ['id', 'label', 'type', 'layer', 'citations', 'attrs']

  it('loads pre-org files to the same shape: no new keys on model or entities', () => {
    for (const raw of [sample, floorSample, legacySample]) {
      const doc = parseMith(raw)
      expect(Object.keys(doc.model)).toEqual(['citations', 'entities', 'edges'])
      for (const e of doc.model.entities) expect(Object.keys(e)).toEqual(baseEntityKeys)
      expect(hasOrgModel(doc)).toBe(false)
    }
    // Arrangement inference is untouched: the v0 stair is still stacked, the floor still coplanar.
    expect(parseMith(legacySample).diagram.arrangement).toBe('stacked')
    expect(parseMith(floorSample).diagram.arrangement).toBe('coplanar')
    expect(parseMith(sample).diagram.arrangement).toBe('coplanar')
  })

  it('loads the synthetic org sample with every section', () => {
    const doc = parseMith(orgSample)
    expect(doc.dataset_kind).toBe('synthetic-demo')
    expect(hasOrgModel(doc)).toBe(true)
    expect(doc.model.boundaries?.map((b) => b.kind)).toContain('team')
    expect(doc.model.boundaries?.filter((b) => b.kind === 'company')).toHaveLength(1)
    expect(doc.model.roles?.length).toBeGreaterThan(4)
    expect(doc.model.grants?.every((g) => ['read', 'approve', 'admin'].includes(g.level))).toBe(true)
    expect(doc.model.actors?.every((a) => a.kind === 'external' && /synthetic/.test(a.label))).toBe(true)
    expect(doc.model.channels?.some((c) => c.verification.includes('none'))).toBe(true)
    const shadow = doc.model.entities.filter((e) => e.sanctioned === false)
    expect(shadow.map((e) => e.source).sort()).toEqual(['expense', 'oauth-grant', 'sso-missing'])
    expect(doc.model.entities.find((e) => e.id === 'sys:idp')?.criticality).toBe('crown-jewel')
    expect(doc.model.entities.find((e) => e.type === 'Person')?.criticality).toBeUndefined()
    const person = doc.model.entities.find((e) => e.type === 'Person')!
    expect(person.boundary).toBeTruthy()
    expect(person.zone).toBeTruthy()
  })

  it('names the reference that failed', () => {
    const bad = (mutate: (d: typeof orgSample) => void) => {
      const copy = structuredClone(orgSample)
      mutate(copy)
      return () => parseMith(copy)
    }
    expect(bad((d) => { d.model.boundaries[1].kind = 'division' })).toThrow(/company, subsidiary, department, team/)
    expect(bad((d) => { d.model.boundaries[1].parent = 'b:nope' })).toThrow(/parent b:nope/)
    expect(bad((d) => { d.model.boundaries[0].parent = 'b:bank-treasury' })).toThrow(/parent cycle/)
    expect(bad((d) => { d.model.entities.find((e: { id: string }) => e.id === 'p:cfo').boundary = 'b:ghost' })).toThrow(/boundary b:ghost/)
    expect(bad((d) => { d.model.entities.find((e: { id: string }) => e.id === 'p:cfo').zone = 'sys:erp' })).toThrow(/not a network-layer entity/)
    expect(bad((d) => { d.model.grants[0].role = 'role:ghost' })).toThrow(/role role:ghost/)
    expect(bad((d) => { d.model.grants[0].level = 'owner' })).toThrow(/read, approve, admin/)
    expect(bad((d) => { d.model.channels[0].to = 'actor:ext-caller' })).toThrow(/not a role/)
    expect(bad((d) => { d.model.channels[0].verification = ['vibes'] })).toThrow(/callback, mfa, dual-approval, none/)
    expect(bad((d) => { d.model.entities[0].sanctioned = 'no' })).toThrow(/sanctioned must be true or false/)
    expect(bad((d) => { d.model.roles[0].id = d.model.entities[0].id })).toThrow(/already used/)
    expect(bad((d) => { d.model.entities.find((e: { id: string }) => e.id === 'sys:erp').criticality = 'extreme' })).toThrow(/low, medium, high, crown-jewel/)
  })
})

describe('parseMithrilPackage', () => {
  it('reads the v0 stub manifest', () => {
    const pkg = parseMithrilPackage(pack)
    expect(pkg.id).toBe('polaris-fi-synthetic')
    expect(pkg.documents).toEqual(['polaris-fi.mith', 'polaris-floor.mith', 'polaris-org.mith'])
  })
})

describe('fromLayers', () => {
  it('turns synthetic JSON layers into a document', () => {
    const layer = (id: LayerData['layer'], nodeId: string): LayerData => ({
      layer: id,
      dataset_kind: 'synthetic-demo',
      generated_at: '2026-09-27T00:00:00Z',
      elements: {
        nodes: [{ data: { id: nodeId, label: nodeId, type: 'Other', layer: id } }],
        edges: [],
      },
    })
    const attack: AttackPathsOverlay = {
      layer: 'attack-paths',
      dataset_kind: 'synthetic-demo',
      generated_at: '2026-09-27T00:00:00Z',
      disclaimer: 'viz only',
      viz_only: true,
      no_runners: true,
      counts: { nodes: 0, edges: 0, scenarios: 1 },
      elements: { nodes: [], edges: [] },
      scenarios: [
        {
          id: 'path:demo',
          label: 'Demo hypothesis',
          summary: 'illustrative',
          category: 'fraud',
          honesty: 'hypothesis',
          observation_count: 0,
          node_ids: ['org:a'],
          edge_kinds_highlight: [],
          raci_catch: [],
          steps: [],
        },
      ],
    }
    const doc = fromLayers(
      [layer('organization', 'org:a'), layer('network', 'net:a')],
      attack,
    )
    expect(doc.mith).toBe('0.1')
    expect(doc.diagram.arrangement).toBe('coplanar')
    expect(doc.diagram.planes.map((p) => p.id)).toEqual(['plane:organization', 'plane:network'])
    expect(new Set(doc.diagram.planes.map((p) => p.transform.z))).toEqual(new Set([0]))
    expect(doc.diagram.planes[0]?.transform.x).not.toBe(doc.diagram.planes[1]?.transform.x)
    expect(doc.inference.hypotheses[0]?.relative_score).toBeGreaterThan(0)
    expect(doc.inference.hypotheses[0]?.observation_count).toBe(0)
  })
})

describe('grid geometry', () => {
  const planes: MithPlane[] = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
    id,
    layer: id,
    label: id,
    transform: { x: 0, y: 0, z: 0, tilt: 54, yaw: -28 },
    placements: [],
  }))

  it('windows three planes around the focus', () => {
    expect(windowStart(0, 5)).toBe(0)
    expect(windowStart(2, 5)).toBe(1)
    expect(windowStart(4, 5)).toBe(2)
    expect(visiblePlanes(planes, 'e').map((p) => p.id)).toEqual(['c', 'd', 'e'])
  })

  it('places coplanar boards by relative xy on one floor', () => {
    const laid = coplanarFloor([
      { ...planes[0]!, id: 'a', transform: { x: 100, y: 40, z: 0, tilt: 54, yaw: -28 } },
      { ...planes[1]!, id: 'b', transform: { x: 420, y: 56, z: 0, tilt: 54, yaw: -28 } },
    ])
    expect(laid.boards).toEqual([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 320, y: 16 },
    ])
    expect(laid.width).toBe(320 + COPLANAR_BOARD_W)
    expect(laid.height).toBe(16 + COPLANAR_BOARD_H)
  })

  it('names the board that owns an entity, not a highlighted neighbor', () => {
    const owned = boardForEntity(
      [
        { ...planes[0]!, id: 'plane:organization', layer: 'organization', label: 'Holding', placements: [{ entity: 'org:holdings', x: 0.2, y: 0.2 }] },
        { ...planes[1]!, id: 'plane:network', layer: 'network', label: 'Polaris Core', placements: [{ entity: 'net:core', x: 0.5, y: 0.5 }] },
        { ...planes[2]!, id: 'plane:firewall', layer: 'firewall', label: 'Edge Guards', placements: [{ entity: 'net:core', x: 0.4, y: 0.4 }] },
      ],
      'net:core',
      'network',
    )
    expect(owned?.label).toBe('Polaris Core')
  })

  it('pans a board clear of the side rails and zooms out when the floor is wider than the gap', () => {
    const stageCenter = { x: 720, y: 450 }
    const nudge = fitBoardsInSafeArea({
      zoom: 0.96,
      pan: { x: 0, y: 0 },
      content: { left: 200, top: 280, right: 900, bottom: 620 },
      safe: { left: 340, top: 80, right: 1100, bottom: 820 },
      stageCenter,
    })
    expect(nudge?.zoom).toBe(0.96)
    expect(nudge?.pan.x).toBeGreaterThan(100)

    const shrunk = fitBoardsInSafeArea({
      zoom: 1,
      pan: { x: 0, y: 0 },
      content: { left: 80, top: 200, right: 1400, bottom: 640 },
      safe: { left: 340, top: 80, right: 1100, bottom: 820 },
      stageCenter,
    })
    expect(shrunk).not.toBeNull()
    expect(shrunk!.zoom).toBeLessThan(1)
    const k = shrunk!.zoom
    const center = { x: (80 + 1400) / 2, y: (200 + 640) / 2 }
    const safeCenter = { x: (340 + 1100) / 2, y: (80 + 820) / 2 }
    const landedX = stageCenter.x + k * (center.x - stageCenter.x - 0) + 0 + (shrunk!.pan.x - 0)
    const landedY = stageCenter.y + k * (center.y - stageCenter.y) + shrunk!.pan.y
    expect(Math.abs(landedX - safeCenter.x)).toBeLessThan(1.5)
    expect(Math.abs(landedY - safeCenter.y)).toBeLessThan(1.5)
    expect(fitBoardsInSafeArea({
      zoom: 1,
      pan: { x: 0, y: 0 },
      content: { left: 400, top: 200, right: 1000, bottom: 600 },
      safe: { left: 340, top: 80, right: 1100, bottom: 820 },
      stageCenter,
    })).toBeNull()
  })

  it('draws a lifted quadratic between two points', () => {
    const d = crossArcPath({ x: 10, y: 80 }, { x: 90, y: 40 })
    expect(d.startsWith('M 10.0 80.0 Q')).toBe(true)
    expect(d).toContain('90.0 40.0')
  })
})
