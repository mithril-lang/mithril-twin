/* global process, console, fetch, AbortSignal */
/** Translate authored Twin viewer chrome; never translate .mith records or identifiers. */
import fs from 'node:fs'
import path from 'node:path'

const outPath = path.resolve(import.meta.dirname, '../apps/viewer/src/twin/twin-copy.json')
const target = JSON.parse(fs.readFileSync(outPath, 'utf8'))
const source = target.copy.ja
const locales = ['zh-Hans', 'hi', 'es', 'ar', 'fr', 'bn', 'pt', 'id', 'ur', 'ru', 'de', 'ko', 'pcm', 'arz', 'mr', 'jv', 'su', 'he', 'it', 'ar-MA']
const names = {
  'zh-Hans': 'Simplified Chinese', hi: 'Hindi', es: 'Spanish', ar: 'Modern Standard Arabic', fr: 'French', bn: 'Bengali',
  pt: 'region-neutral Portuguese', id: 'Indonesian', ur: 'Urdu', ru: 'Russian', de: 'German', ko: 'Korean',
  pcm: 'Nigerian Pidgin', arz: 'Egyptian Arabic', mr: 'Marathi', jv: 'Javanese', su: 'Sundanese', he: 'Hebrew',
  it: 'Italian', 'ar-MA': 'Moroccan Darija',
}
const markers = (value) => [...value.matchAll(/\{[a-zA-Z]+\}/g)].map(([match]) => match).sort().join('|')
function validate(locale, copy, keys = Object.keys(source)) {
  if (!copy || keys.some((key) => !(key in copy))) throw new Error(`${locale}: missing Twin strings`)
  for (const key of keys) {
    const value = copy[key]
    if (typeof value !== 'string' || !value.trim() || markers(value) !== markers(key) ||
      (key.includes('.mith') && !value.includes('.mith')) || (key.includes('Mithril') && !value.includes('Mithril'))) {
      throw new Error(`${locale}: invalid Twin translation for ${key}`)
    }
  }
}
validate('ja', source)
if (process.argv.includes('--check')) {
  for (const locale of locales) validate(locale, target.copy[locale])
  console.log(`Twin viewer chrome: ${Object.keys(source).length} strings × 22 locales complete`)
  process.exit(0)
}
const key = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_APIKEY
if (!key) throw new Error('OPENROUTER_API_KEY is required')
const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-5'
async function translateLocale(locale) {
  const localeRule = locale === 'pcm'
    ? 'Use natural Naijá Pidgin for navigation and instructions, including short button labels. Do not copy English UI labels merely because Pidgin shares English vocabulary. Examples: "Search objects" → "Find di objects", "Details" → "Full tori", "Close details" → "Close di full tori", "Choose an object on a plane." → "Choose one object for di plane." Keep actual product names and technical identifiers.'
    : ''
  let attempts = 0
  while (true) {
    const missing = Object.entries(source).filter(([en]) => !(en in (target.copy[locale] ?? {})))
    if (!missing.length) { validate(locale, target.copy[locale]); break }
    if (++attempts > 16) throw new Error(`${locale}: ${missing.length} translations still missing`)
    const needed = Object.fromEntries(missing.slice(0, 10))
    const prompt = `Translate Mithril Twin viewer interface text from English to ${names[locale]} (${locale}). Japanese wording provides context. This is a fictional, display-only digital twin viewer. Do not imply production execution, validation, or a live system connection. Preserve .mith, Mithril, Twin, technical identifiers and every {placeholder} exactly. ${localeRule} Return only one JSON object whose keys are exactly the English source strings.\nENGLISH: ${JSON.stringify(Object.fromEntries(Object.keys(needed).map((en) => [en, en])))}\nJAPANESE: ${JSON.stringify(needed)}`
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(90000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://mithril.fund', 'X-Title': 'Mithril Twin localization' },
        body: JSON.stringify({ model, temperature: 0.2, max_tokens: 8000, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
      })
      if (!response.ok) throw new Error(`${locale}: translation API returned ${response.status}`)
      const result = await response.json()
      const raw = result.choices?.[0]?.message?.content
      if (typeof raw !== 'string') throw new Error(`${locale}: translation API returned no text`)
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      if (start < 0 || end <= start) throw new Error(`${locale}: translation API returned no JSON object`)
      const translated = JSON.parse(raw.slice(start, end + 1))
      const accepted = Object.fromEntries(Object.keys(needed).filter((en) => en in translated).map((en) => [en, translated[en]]))
      if (!Object.keys(accepted).length) throw new Error(`${locale}: translation API returned no requested keys`)
      validate(locale, accepted, Object.keys(accepted))
      target.copy[locale] = { ...target.copy[locale], ...accepted }
      target.provenance[locale] = { model: result.model || model, date: new Date().toISOString().slice(0, 10), source: 'Twin viewer chrome' }
      fs.writeFileSync(outPath, `${JSON.stringify(target, null, 2)}\n`)
      console.log(`${locale}: ${Object.keys(accepted).length} strings`)
    } catch (error) {
      if (attempts >= 16) throw error
      console.warn(`${locale}: retrying ${Object.keys(needed).length} strings after ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
for (let start = 0; start < locales.length; start += 4) {
  await Promise.all(locales.slice(start, start + 4).map(translateLocale))
}
