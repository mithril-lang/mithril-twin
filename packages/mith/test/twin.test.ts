import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseForm } from '../src/form'
import { MithParseError, parseMith } from '../src/parse'
import { admitTwin, readMith, readMithRaw, toTwinForm } from '../src/twin'

const here = dirname(fileURLToPath(import.meta.url))
const pub = (name: string) => readFileSync(resolve(here, '../samples', name), 'utf8')
const legacyText = readFileSync(resolve(here, 'fixtures/polaris-fi.v0-stacked.mith'), 'utf8')

describe('twin reader (Form primary, JSON-LD, legacy v0 deprecated)', () => {
  it('reads the shipped 北極星 fixtures as Mithril Form', () => {
    for (const f of ['polaris-org.mith', 'polaris-fi.mith', 'polaris-floor.mith']) {
      const text = pub(f)
      expect(text.trimStart().startsWith('(mithril/twin-document')).toBe(true)
      const r = readMith(text)
      expect(r.format).toBe('form')
      expect(r.deprecated).toBe(false)
      expect(r.doc.dataset_kind).toBe('synthetic-demo')
    }
  })

  it('round-trips document → Form → document without loss', () => {
    for (const f of ['polaris-org.mith', 'polaris-fi.mith', 'polaris-floor.mith']) {
      const doc = readMith(pub(f)).doc
      expect(readMith(toTwinForm(doc)).doc).toEqual(doc)
    }
  })

  it('reads the lowered JSON-LD spelling and still reads legacy v0 JSON (flagged deprecated)', () => {
    const form = pub('polaris-org.mith')
    const jsonld = readMith(JSON.stringify(parseForm(form)))
    expect(jsonld.format).toBe('jsonld')
    expect(jsonld.doc).toEqual(readMith(form).doc)
    const legacy = readMith(legacyText)
    expect(legacy.format).toBe('legacy-v0')
    expect(legacy.deprecated).toBe(true)
    expect(legacy.doc).toEqual(parseMith(JSON.parse(legacyText)))
  })

  it('writes non-integers as xsd:decimal typed literals', () => {
    const doc = readMith(pub('polaris-org.mith')).doc
    const form = toTwinForm({ ...doc, model: { ...doc.model, weights: { networkValue: 0.5, device: { eol: 0.25 } } } })
    expect(form).toContain(':network-value (rdf/literal "0.5" :datatype "xsd:decimal")')
    expect(readMith(form).doc.model.weights).toEqual({ networkValue: 0.5, device: { eol: 0.25 } })
  })

  it('admits only the closed twin vocabulary', () => {
    const lowered = parseForm(pub('polaris-floor.mith'))
    expect(() => admitTwin({ ...lowered, surprise: 1 })).toThrow(/unknown twin document key "surprise"/)
    expect(() => admitTwin({ ...lowered, '@context': 'https://mithril.fund/context/v1' })).toThrow(/pinned twin context/)
    expect(() => admitTwin({ ...lowered, datasetKind: 'live' })).toThrow(/synthetic-demo/)
    expect(() => admitTwin({ ...lowered, inference: { vizOnly: true, noRunners: false } })).toThrow(/vizOnly and noRunners/)
    const withExtra = JSON.parse(JSON.stringify(lowered))
    withExtra.entities[0].payload = 'x'
    expect(() => admitTwin(withExtra)).toThrow(/unknown twin key "payload"/)
    expect(() => readMith('(mithril/growth-decision :id "x")')).toThrow(MithParseError)
  })

  it('exposes the pre-validation record for Form and JSON alike', () => {
    const raw = readMithRaw(pub('polaris-floor.mith'))
    expect(raw.mith).toBe('0.1')
    expect(parseMith(raw)).toEqual(readMith(pub('polaris-floor.mith')).doc)
  })
})
