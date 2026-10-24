import japanese from './twin-copy-locales/ja.json'

const loaders: Record<string, () => Promise<{ default: Record<string, string> }>> = {
  'zh-Hans': () => import('./twin-copy-locales/zh-Hans.json'),
  'hi': () => import('./twin-copy-locales/hi.json'),
  'es': () => import('./twin-copy-locales/es.json'),
  'ar': () => import('./twin-copy-locales/ar.json'),
  'fr': () => import('./twin-copy-locales/fr.json'),
  'bn': () => import('./twin-copy-locales/bn.json'),
  'pt': () => import('./twin-copy-locales/pt.json'),
  'id': () => import('./twin-copy-locales/id.json'),
  'ur': () => import('./twin-copy-locales/ur.json'),
  'ru': () => import('./twin-copy-locales/ru.json'),
  'de': () => import('./twin-copy-locales/de.json'),
  'ko': () => import('./twin-copy-locales/ko.json'),
  'pcm': () => import('./twin-copy-locales/pcm.json'),
  'arz': () => import('./twin-copy-locales/arz.json'),
  'mr': () => import('./twin-copy-locales/mr.json'),
  'jv': () => import('./twin-copy-locales/jv.json'),
  'su': () => import('./twin-copy-locales/su.json'),
  'he': () => import('./twin-copy-locales/he.json'),
  'it': () => import('./twin-copy-locales/it.json'),
  'ar-MA': () => import('./twin-copy-locales/ar-MA.json'),
}
const copy: Record<string, Record<string, string>> = { ja: japanese }
const pending = new Map<string, Promise<void>>()
const ready = Promise.resolve()

/** Fetch only the selected Twin locale. The promise is stable for React Suspense. */
export function loadTwinCopy(locale: string): Promise<void> {
  if (locale === 'en' || locale === 'ja') return ready
  const existing = pending.get(locale)
  if (existing) return existing
  const loader = loaders[locale]
  if (!loader) return ready
  const request = loader().then((module) => { copy[locale] = module.default }).catch((error: unknown) => {
    pending.delete(locale)
    throw error
  })
  pending.set(locale, request)
  return request
}

/** Translate viewer chrome only. Labels and assertions from .mith remain source data. */
export function twinCopy(locale: string, english: string, values: Record<string, string | number> = {}): string {
  const message = copy[locale]?.[english] ?? english
  return message.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => key in values ? String(values[key]) : match)
}
