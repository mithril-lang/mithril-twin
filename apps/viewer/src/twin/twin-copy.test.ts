import { describe, expect, it } from 'vitest'
import { LOCALES } from '../locale'
import translations from './twin-copy.json'
import { loadTwinCopy, twinCopy } from './twin-copy'

describe('Twin viewer chrome translations', () => {
  it('has copy for every authored control in all 22 public locales', () => {
    const authored = Object.keys(translations.copy.ja)
    for (const locale of LOCALES) {
      if (locale === 'en') continue
      const copy = (translations.copy as Record<string, Record<string, string>>)[locale]
      expect(copy, `${locale} dictionary`).toBeTruthy()
      for (const source of authored) {
        expect(copy?.[source], `${locale}: ${source}`).toBeTruthy()
      }
    }
  })

  it('interpolates only authored UI placeholders and leaves source data untouched', () => {
    expect(twinCopy('ja', 'Hypothesis “{name}” touches this object.', { name: 'Bank Core VLAN' }))
      .toBe('仮説「Bank Core VLAN」はこのオブジェクトに関係します。')
    expect(twinCopy('ja', 'Bank Core VLAN')).toBe('Bank Core VLAN')
    expect(twinCopy('en', 'Open')).toBe('Open')
  })

  it('loads a selected locale from its own chunk', async () => {
    await loadTwinCopy('ar')
    expect(twinCopy('ar', 'Details')).toBe(translations.copy.ar.Details)
  })
})
