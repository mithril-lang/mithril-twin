import type { AttackPathsOverlay, GraphItem, LayerData, TwinLayer } from '../data/types'
import type { AttackScenario } from '../data/types'
import { fromLayers } from './fromLayers'
import { parseMith, parseMithrilPackage } from './parse'
import type { MithDocument, MithHypothesis } from './types'

export const SAMPLE_MITH_URL = '/data/polaris-fi.mith'
export const SAMPLE_PACKAGE_URL = '/data/polaris-fi.mithril'
export const ORG_SAMPLE_MITH_URL = '/data/polaris-org.mith'

/**
 * Synthetic samples the grid can open. The first entry loads by default.
 * `pack: true` is the enterprise-scale pack: generated in the browser (Web Worker) from a seed,
 * never shipped as files. `url` is unused for it.
 */
export const SAMPLE_DOCS: { id: string; file: string; url: string; label: string; pack?: boolean; seed?: number }[] = [
  { id: 'polaris-enterprise', file: 'polaris-enterprise (generated in browser)', url: '', label: 'Enterprise scale (synthetic)', pack: true, seed: 20260927 },
  { id: 'polaris-org', file: 'polaris-org.mith', url: ORG_SAMPLE_MITH_URL, label: 'Org & access lenses' },
  { id: 'polaris-fi', file: 'polaris-fi.mith', url: SAMPLE_MITH_URL, label: 'Layer boards' },
  { id: 'polaris-floor', file: 'polaris-floor.mith', url: '/data/polaris-floor.mith', label: 'Tiny floor' },
]

/** `?doc=polaris-fi` picks a committed sample; anything else falls back to the default. */
export function sampleDocFromSearch(search: string) {
  const id = new URLSearchParams(search).get('doc')
  return SAMPLE_DOCS.find((d) => d.id === id) ?? SAMPLE_DOCS[0]!
}

const LAYER_FILES: TwinLayer[] = ['organization', 'network', 'firewall', 'node', 'server']

export type LoadedMith = {
  doc: MithDocument
  packageId: string | null
}

export async function loadSampleMith(
  fetchImpl: typeof fetch = fetch,
  url: string = SAMPLE_MITH_URL,
): Promise<LoadedMith> {
  const response = await fetchImpl(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  const doc = parseMith(await response.json())
  let packageId: string | null = null
  try {
    const pkg = await fetchImpl(SAMPLE_PACKAGE_URL)
    if (pkg.ok) packageId = parseMithrilPackage(await pkg.json()).id
  } catch {
    packageId = null
  }
  return { doc, packageId }
}

/** Secondary import. Layer JSON stays on disk; it is not the primary document. */
export async function importJsonLayers(fetchImpl: typeof fetch = fetch): Promise<MithDocument> {
  const layers = await Promise.all(
    LAYER_FILES.map(async (layer) => {
      const response = await fetchImpl(`/data/layers/${layer}.json`)
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${layer}.json`)
      return (await response.json()) as LayerData
    }),
  )
  let attack: AttackPathsOverlay | null = null
  try {
    const response = await fetchImpl('/data/layers/attack-paths.json')
    if (response.ok) attack = (await response.json()) as AttackPathsOverlay
  } catch {
    attack = null
  }
  return fromLayers(layers, attack)
}

export function mithLayerItems(
  doc: MithDocument,
  layer: string,
): { nodes: GraphItem[]; edges: GraphItem[] } {
  const nodes: GraphItem[] = doc.model.entities
    .filter((e) => e.layer === layer)
    .map((e) => ({
      data: {
        id: e.id,
        label: e.label,
        type: e.type,
        layer: String(e.layer),
        ...e.attrs,
      },
    }))
  const ids = new Set(nodes.map((n) => n.data.id))
  const edges: GraphItem[] = doc.model.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({
      data: { id: e.id, source: e.source, target: e.target, kind: e.kind },
    }))
  return { nodes, edges }
}

export function hypothesisToScenario(h: MithHypothesis): AttackScenario {
  return {
    id: h.id,
    label: h.label,
    summary: h.summary,
    category: h.category,
    honesty: h.honesty,
    observation_count: h.observation_count,
    node_ids: h.node_ids,
    edge_kinds_highlight: [],
    raci_catch: [],
    steps: h.steps,
  }
}
