import type { AttackPathsOverlay, LayerData, TwinLayer } from './layers'
import { slimNodes } from './layers'
import { gridPositions } from './geometry'
import { MithParseError } from './parse'
import type { MithCrossLink, MithDocument, MithEntity } from './types'

const ORDER: TwinLayer[] = ['organization', 'network', 'firewall', 'node', 'server']

const LAYER_LABEL: Record<TwinLayer, string> = {
  organization: 'Organization',
  network: 'Network',
  firewall: 'Firewall',
  node: 'Node',
  server: 'Server',
}

/**
 * Secondary path: turn the legacy per-layer JSON files into a .mith document.
 * The primary interchange is the hand-authored .mith sample.
 */
export function fromLayers(layers: LayerData[], attack: AttackPathsOverlay | null): MithDocument {
  if (!layers.length) throw new MithParseError('no JSON layers to import')
  if (layers.some((l) => l.dataset_kind !== 'synthetic-demo')) {
    throw new MithParseError('JSON layers must be synthetic-demo')
  }
  if (attack && attack.dataset_kind !== 'synthetic-demo') {
    throw new MithParseError('attack overlay must be synthetic-demo')
  }

  const sorted = [...layers].sort((a, b) => ORDER.indexOf(a.layer) - ORDER.indexOf(b.layer))
  const entities: MithEntity[] = []
  const seen = new Set<string>()
  const edges: MithDocument['model']['edges'] = []
  const planes: MithDocument['diagram']['planes'] = []

  sorted.forEach((layer, index) => {
    const slim = slimNodes(layer.elements.nodes, 12)
    const ids = new Set(slim.map((n) => n.data.id).filter(Boolean))
    for (const node of slim) {
      const id = node.data.id
      if (!id || seen.has(id)) continue
      seen.add(id)
      const { label, type, layer: entityLayer, ...rest } = node.data
      const attrs: Record<string, string> = {}
      for (const [key, value] of Object.entries(rest)) {
        if (key === 'id' || typeof value !== 'string') continue
        attrs[key] = value
      }
      entities.push({
        id,
        label: label || id,
        type: type || 'Other',
        layer: entityLayer || layer.layer,
        citations: [{ source: `layers/${layer.layer}.json`, note: 'JSON import' }],
        attrs,
      })
    }
    for (const edge of layer.elements.edges) {
      const source = edge.data.source
      const target = edge.data.target
      if (!source || !target || !ids.has(source) || !ids.has(target)) continue
      const edgeId = edge.data.id || `edge:${source}:${target}`
      if (edges.some((e) => e.id === edgeId)) continue
      edges.push({
        id: edgeId,
        source,
        target,
        kind: edge.data.kind || 'relates',
      })
      if (edges.length > 80) break
    }
    const pos = gridPositions(slim.length)
    const placements = slim.flatMap((node, i) => {
      const entityId = node.data.id
      if (!entityId) return []
      return [{
        entity: entityId,
        x: pos[i]?.x ?? 0.5,
        y: pos[i]?.y ?? 0.5,
        tone: (i === 0 ? 'accent' : i === 1 ? 'info' : 'quiet') as 'quiet' | 'accent' | 'info',
        ...(i === 0 ? { showLabel: true as const } : {}),
      }]
    })
    const col = index % 3
    const row = Math.floor(index / 3)
    planes.push({
      id: `plane:${layer.layer}`,
      layer: layer.layer,
      label: LAYER_LABEL[layer.layer] ?? layer.layer,
      transform: {
        x: col * 320,
        y: row * 220 + (col === 1 ? 16 : 0),
        z: 0,
        tilt: 54,
        yaw: -28,
      },
      placements,
    })
  })

  const byId = new Map(entities.map((e) => [e.id, e]))
  const crossLinks: MithCrossLink[] = []
  for (let i = 0; i < planes.length - 1 && crossLinks.length < 8; i++) {
    const upper = planes[i]
    const lower = planes[i + 1]
    if (!upper || !lower) continue
    const upperIds = new Set(upper.placements.map((p) => p.entity))
    let pair = 0
    for (const placement of lower.placements) {
      if (pair >= 3 || crossLinks.length >= 8) break
      const ent = byId.get(placement.entity)
      const org = ent?.attrs.org
      if (org && upperIds.has(org) && org !== placement.entity) {
        crossLinks.push({
          id: `xl:${org}:${placement.entity}`,
          from: org,
          to: placement.entity,
          kind: 'shared-ref',
        })
        pair++
      }
    }
  }

  const hypotheses = (attack?.scenarios ?? []).slice(0, 5).map((scenario, i) => ({
    id: scenario.id,
    label: scenario.label,
    summary: scenario.summary,
    category: scenario.category,
    honesty: 'hypothesis' as const,
    observation_count: 0,
    relative_score: Number((0.18 + i * 0.06).toFixed(2)),
    score_note: 'Illustrative rank among synthetic hypotheses. Not a detection score.',
    node_ids: scenario.node_ids,
    steps: scenario.steps,
  }))

  const focus = planes[1]?.id ?? planes[0]?.id ?? 'plane:organization'
  return {
    mith: '0.1',
    kind: 'document',
    id: 'imported-json-layers',
    title: 'Imported JSON layers',
    dataset_kind: 'synthetic-demo',
    generated_at: new Date().toISOString(),
    disclaimer:
      'Imported from legacy layer JSON. Synthetic-demo only. Hypothesis overlays are visualization, not runners.',
    model: {
      citations: sorted.map((layer) => ({
        source: `layers/${layer.layer}.json`,
        note: 'secondary JSON import',
      })),
      entities,
      edges,
    },
    diagram: {
      arrangement: 'coplanar',
      camera: { mode: 'iso', tilt: 54, yaw: -28, zoom: 0.74, focusPlane: focus },
      selection: planes[1]?.placements[0]?.entity ?? planes[0]?.placements[0]?.entity ?? null,
      planes,
      crossLinks,
    },
    inference: {
      viz_only: true,
      no_runners: true,
      hypotheses,
    },
  }
}
