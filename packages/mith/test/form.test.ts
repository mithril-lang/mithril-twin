import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isFormSource, MithFormError, parseForm, TWIN_CONTEXT } from '../src/form'
import { readMith, toTwinForm } from '../src/twin'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) => readFileSync(resolve(here, 'fixtures', name), 'utf8')

const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof MithFormError ? e.code : `other: ${String(e)}`
  }
  return 'no error'
}

describe('Mithril Form reader (mirrors upstream mithril.form)', () => {
  it('lowers the upstream twin example exactly like upstream form.cljk (kbb output checked in)', () => {
    const lowered = parseForm(fixture('upstream-twin-polaris-device.mith'))
    const upstream = JSON.parse(fixture('upstream-twin-polaris-device.lowered.json'))
    expect(JSON.parse(JSON.stringify(lowered))).toEqual(upstream)
    expect(lowered['@context']).toBe(TWIN_CONTEXT)
    expect(lowered['@type']).toBe('TwinDocument')
  })

  it('lowers the upstream workshop-view example (lens, frame, workshop-export) exactly like upstream', () => {
    const lowered = parseForm(fixture('upstream-twin-workshop-view.mith'))
    expect(JSON.parse(JSON.stringify(lowered))).toEqual(JSON.parse(fixture('upstream-twin-workshop-view.lowered.json')))
    const read = readMith(fixture('upstream-twin-workshop-view.mith'))
    expect(read.doc.dataset_kind).toBe('workshop-export')
    expect(read.doc.diagram.lens).toBe('impersonation')
    expect(read.doc.diagram.frame).toBe('network')
    expect(readMith(toTwinForm(read.doc)).doc).toEqual(read.doc)
  })

  it('maps kebab keywords to camelCase terms and keeps typed decimals', () => {
    const doc = parseForm(`(mithril/twin-document :id "https://mithril.fund/lib/twin/x" :dataset-kind "synthetic-demo"
      :weights (rdf/node :network-value (rdf/literal "0.6" :datatype "xsd:decimal") :min-retention-days 30))`)
    expect(doc.datasetKind).toBe('synthetic-demo')
    expect(doc.weights).toEqual({ networkValue: { '@value': '0.6', '@type': 'xsd:decimal' }, minRetentionDays: 30 })
  })

  it('detects form sources and skips comments / discard forms', () => {
    expect(isFormSource('  (mithril/twin-document)')).toBe(true)
    expect(isFormSource('{"mith": "0.1"}')).toBe(false)
    const doc = parseForm('(mithril/twin-document ;; comment\n #_ :ignored #_ "x" :title "t" :id "https://mithril.fund/lib/twin/y")')
    expect(doc.title).toBe('t')
  })

  it('refuses what upstream refuses, with upstream error codes', () => {
    expect(code(() => parseForm('(mithril/twin-document :title "a" :title "b")'))).toBe('mithril.form/duplicate-field')
    expect(code(() => parseForm('(mithril/twin-document :title)'))).toBe('mithril.form/field-arity')
    expect(code(() => parseForm('(mithril/nope :title "a")'))).toBe('mithril.form/unknown-tag')
    expect(code(() => parseForm('(mithril/twin-document "title")'))).toBe('mithril.form/field-arity')
    expect(code(() => parseForm('(mithril/twin-document :title "a") (mithril/twin-document)'))).toBe('mithril.form/form-count')
    expect(code(() => parseForm('(mithril/twin-document :weight 0.5)'))).toBe('mithril.form/unsupported-value')
    expect(code(() => parseForm('(mithril/twin-document :title "a"'))).toBe('mithril.form/read-error')
    expect(code(() => parseForm('(mithril/twin-document :title \'a)'))).toBe('mithril.form/read-error')
  })
})
