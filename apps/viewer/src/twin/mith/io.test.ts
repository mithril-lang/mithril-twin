import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { enterpriseFiles } from '../scale/generate'
import {
  applyDiagramView,
  buildMithDownload,
  formatBytes,
  importLocalFiles,
  MITH_FORM_MIME,
  MITH_MIME,
  serializeMith,
  type MithViewState,
} from './io'
import { parseMith } from './parse'
import { readMith } from './twin'
import type { MithDocument } from './types'

const here = dirname(fileURLToPath(import.meta.url))
const pub = (name: string) => readMith(readFileSync(resolve(here, '../../../public/data', name), 'utf8')).doc
const sample = pub('polaris-fi.mith')
const floor = pub('polaris-floor.mith')
const org = pub('polaris-org.mith')
/** Read an exported body back with the same reader the grid uses. */
const back = (body: string) => readMith(body).doc
const legacy = parseMith(JSON.parse(readFileSync(resolve(here, '../../../../../packages/mith/test/fixtures/polaris-fi.v0-stacked.mith'), 'utf8')))
const packText = readFileSync(resolve(here, '../../../public/data/polaris-fi.mithril'), 'utf8')

function viewOf(doc: MithDocument, patch: Partial<MithViewState> = {}): MithViewState {
  return {
    arrangement: doc.diagram.arrangement,
    camera: { ...doc.diagram.camera },
    selection: doc.diagram.selection,
    lens: doc.diagram.lens,
    frame: doc.diagram.frame,
    ...patch,
  }
}

describe('mith export', () => {
  it('exports upstream Form and round-trips camera, selection, model, and inference', () => {
    const view = viewOf(org, {
      arrangement: 'coplanar',
      lens: 'impersonation',
      frame: 'network',
      selection: 'role:cfo',
      camera: { ...org.diagram.camera, mode: 'ortho', zoom: 1.2, focusPlane: org.diagram.camera.focusPlane },
    })
    const file = buildMithDownload(org, view)
    expect(file.mime).toBe(MITH_FORM_MIME)
    expect(file.format).toBe('form')
    expect(file.note).toBeNull()
    expect(file.body.startsWith('(mithril/twin-document')).toBe(true)
    expect(file.filename).toMatch(/\.mith$/)
    expect(file.bytes).toBe(new TextEncoder().encode(file.body).length)

    const read = readMith(file.body)
    expect(read.format).toBe('form')
    const parsed = read.doc
    expect(parsed.dataset_kind).toBe('synthetic-demo')
    // Upstream twin Form has no lens / frame terms: they are not written.
    expect(parsed.diagram.lens).toBeUndefined()
    expect(parsed.diagram.frame).toBeUndefined()
    expect(parsed.diagram.selection).toBe('role:cfo')
    expect(parsed.diagram.camera.mode).toBe('ortho')
    expect(parsed.diagram.camera.zoom).toBe(1.2)
    expect(parsed.diagram.arrangement).toBe('coplanar')
    expect(parsed.model).toEqual(org.model)
    expect(parsed.inference).toEqual(org.inference)

    const again = back(serializeMith(parsed).body)
    expect(again).toEqual(parsed)
    expect(back(buildMithDownload(parsed, viewOf(parsed)).body)).toEqual(parsed)
  })

  it('keeps a declared dataset_kind by writing legacy v0 JSON (Form only admits synthetic-demo)', () => {
    const declared = parseMith({ ...JSON.parse(JSON.stringify(floor)), dataset_kind: 'workshop-export' })
    const file = buildMithDownload(declared, viewOf(declared, { lens: 'layers', frame: 'org' }))
    expect(file.format).toBe('legacy-v0')
    expect(file.mime).toBe(MITH_MIME)
    expect(file.note).toMatch(/workshop-export/)
    const read = readMith(file.body)
    expect(read.deprecated).toBe(true)
    expect(read.doc.dataset_kind).toBe('workshop-export')
    expect(read.doc.diagram.lens).toBe('layers')
  })

  it('re-imports a legacy v0 JSON file and exports it as Form', () => {
    const opened = importLocalFiles([{ name: 'legacy.mith', text: JSON.stringify(legacy) }])
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.note).toMatch(/legacy v0 JSON \(deprecated\)/)
    const file = buildMithDownload(opened.doc, viewOf(opened.doc))
    expect(file.format).toBe('form')
    const reopened = importLocalFiles([{ name: file.filename, text: file.body }])
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.note).toBeNull()
    expect(reopened.doc.model).toEqual(legacy.model)
  })

  it('writes a stacked stair without moving coplanar boards, and spreads an overlapping stair onto one floor', () => {
    const stacked = back((buildMithDownload(sample, viewOf(sample, { arrangement: 'stacked' })).body))
    expect(stacked.diagram.arrangement).toBe('stacked')
    expect(new Set(stacked.diagram.planes.map((p) => p.transform.z)).size).toBe(stacked.diagram.planes.length)
    expect(stacked.diagram.planes.map((p) => p.transform.x)).toEqual(sample.diagram.planes.map((p) => p.transform.x))

    const flat = back((buildMithDownload(legacy, viewOf(legacy, { arrangement: 'coplanar' })).body))
    expect(flat.diagram.arrangement).toBe('coplanar')
    expect(new Set(flat.diagram.planes.map((p) => p.transform.z))).toEqual(new Set([0]))
    const again = back(serializeMith(applyDiagramView(flat, viewOf(flat))).body)
    expect(again.diagram.planes.map((p) => [p.transform.x, p.transform.y, p.transform.z])).toEqual(
      flat.diagram.planes.map((p) => [p.transform.x, p.transform.y, p.transform.z]),
    )
  })

  it('refuses to export runner, executor, payload, or secret keys', () => {
    const dirty = JSON.parse(JSON.stringify(sample)) as MithDocument & { secret?: string }
    dirty.secret = 'nope'
    expect(() => serializeMith(dirty)).toThrow(/secret is not allowed/)
    const nested = structuredClone(sample) as MithDocument
    ;(nested.model.entities[0] as { payload?: string }).payload = 'x'
    expect(() => serializeMith(nested)).toThrow(/payload is not allowed/)
  })
})

describe('mith import', () => {
  it('parses a local .mith file and reports a non-synthetic label', () => {
    const body = JSON.stringify({ ...JSON.parse(JSON.stringify(floor)), title: 'Imported Floor', dataset_kind: 'workshop-export' })
    const opened = importLocalFiles([{ name: 'imported-floor.mith', text: body }])
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.doc.title).toBe('Imported Floor')
    expect(opened.doc.dataset_kind).toBe('workshop-export')
    expect(opened.filename).toBe('imported-floor.mith')
    expect(opened.note).toMatch(/workshop-export/)
  })

  it('names the parse error for a broken .mith file', () => {
    const opened = importLocalFiles([
      { name: 'bad.mith', text: '{"mith":"0.1","kind":"document","dataset_kind":"synthetic-demo"}' },
    ])
    expect(opened.ok).toBe(false)
    if (opened.ok) return
    expect(opened.message).toMatch(/model must be an object/)

    const junk = importLocalFiles([{ name: 'notes.mith', text: 'not json' }])
    expect(junk.ok).toBe(false)
    if (junk.ok) return
    expect(junk.message).toMatch(/notes\.mith: .*neither a Mithril form nor JSON/)
  })

  it('explains a .mithril package whose member files are missing, and does not fetch URLs', () => {
    const opened = importLocalFiles([{ name: 'polaris-fi.mithril', text: packText }])
    expect(opened.ok).toBe(false)
    if (opened.ok) return
    expect(opened.message).toMatch(/polaris-fi\.mith/)
    expect(opened.message).toMatch(/polaris-floor\.mith/)
    expect(opened.message).toMatch(/were not included/)

    const remote = JSON.stringify({
      mithril: '0.1',
      kind: 'package',
      id: 'remote-pack',
      dataset_kind: 'synthetic-demo',
      documents: ['https://example.invalid/secret.mith'],
      attachments: [],
    })
    const fetched = importLocalFiles([{ name: 'remote.mithril', text: remote }])
    expect(fetched.ok).toBe(false)
    if (fetched.ok) return
    expect(fetched.message).toMatch(/does not fetch URLs/)
    expect(fetched.message).toMatch(/https:\/\/example\.invalid\/secret\.mith/)
  })

  it('opens the first listed member when the .mith files are in the same drop', () => {
    const opened = importLocalFiles([
      { name: 'polaris-fi.mithril', text: packText },
      { name: 'polaris-floor.mith', text: JSON.stringify(floor) },
      { name: 'notes.json', text: '{}' },
    ])
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.filename).toBe('polaris-floor.mith')
    expect(opened.packageId).toBe('polaris-fi-synthetic')
    expect(opened.doc.id).toBe(floor.id)
    expect(opened.note).toMatch(/Not included: polaris-fi\.mith/)
  })

  it('refuses a layer JSON file as an import', () => {
    const opened = importLocalFiles([{ name: 'organization.json', text: '{"layer":"organization"}' }])
    expect(opened.ok).toBe(false)
    if (opened.ok) return
    expect(opened.message).toMatch(/organization\.json/)
    expect(opened.message).toMatch(/\.mith/)
  })
})

describe('enterprise index export', () => {
  it('downloads the index as one .mith and leaves company chunks out', () => {
    const indexText = enterpriseFiles().get('index.mith')
    expect(indexText).toBeTruthy()
    expect(indexText!.startsWith('(mithril/twin-document')).toBe(true)
    const index = readMith(indexText!).doc
    const file = buildMithDownload(index, viewOf(index, { lens: 'access', frame: 'org' }))
    expect(file.filename).toBe('polaris-enterprise-synthetic.mith')
    expect(file.bytes).toBeLessThan(8 * 1024 * 1024)
    expect(file.body).not.toContain('mith_chunk')
    expect(file.body).not.toContain('"companies/')
    expect(file.format).toBe('form')
    const parsed = back(file.body)
    expect(parsed.dataset_kind).toBe('synthetic-demo')
    expect(parsed.model.entities.length).toBe(index.model.entities.length)
    expect(parsed.model.roles?.length).toBe(index.model.roles?.length)
    expect(formatBytes(file.bytes)).toMatch(/MB|KB/)
  })
})
