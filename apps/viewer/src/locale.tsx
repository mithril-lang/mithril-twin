import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import fallbackNotice from './fallback-notice.json'
import './locale.css'

export const LOCALES = [
  'en', 'zh-Hans', 'hi', 'es', 'ar', 'fr', 'bn', 'pt', 'id', 'ur', 'ru', 'de',
  'ja', 'ko', 'pcm', 'arz', 'mr', 'jv', 'su', 'he', 'it', 'ar-MA',
] as const
export type TwinLocale = (typeof LOCALES)[number]
const rtl = new Set<TwinLocale>(['ar', 'arz', 'ur', 'he', 'ar-MA'])
const names: Record<TwinLocale, string> = {
  en: 'English', 'zh-Hans': '简体中文', hi: 'हिन्दी', es: 'Español', ar: 'العربية', fr: 'Français',
  bn: 'বাংলা', pt: 'Português', id: 'Bahasa Indonesia', ur: 'اردو', ru: 'Русский', de: 'Deutsch',
  ja: '日本語', ko: '한국어', pcm: 'Naijá', arz: 'مصري', mr: 'मराठी', jv: 'Basa Jawa',
  su: 'Basa Sunda', he: 'עברית', it: 'Italiano', 'ar-MA': 'الدارجة',
}

function parseLocale(value: string | null): TwinLocale | null {
  if (!value) return null
  if (value.toLowerCase() === 'zh') return 'zh-Hans'
  if (value.toLowerCase() === 'iw') return 'he'
  return LOCALES.find((locale) => locale.toLowerCase() === value.toLowerCase()) ?? null
}

function initialLocale(): TwinLocale {
  const query = parseLocale(new URLSearchParams(window.location.search).get('lang'))
  if (query) return query
  for (const cookie of document.cookie.split(';')) {
    const [name, value] = cookie.trim().split('=')
    if (name !== 'mf_locale' || !value) continue
    try {
      const locale = parseLocale(decodeURIComponent(value))
      if (locale) return locale
    } catch { /* Ignore a malformed cookie. */ }
  }
  return 'en'
}

type LocaleState = { locale: TwinLocale; setLocale: (locale: TwinLocale) => void }
const LocaleContext = createContext<LocaleState | null>(null)

export function useTwinLocale(): LocaleState {
  const context = useContext(LocaleContext)
  if (!context) throw new Error('TwinLocaleProvider is required')
  return context
}

/** Component tests can render the viewer without the site-level locale provider. */
export function useViewerLocale(): TwinLocale {
  return useContext(LocaleContext)?.locale ?? 'en'
}

export function TwinLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setState] = useState<TwinLocale>(initialLocale)
  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = rtl.has(locale) ? 'rtl' : 'ltr'
    const host = window.location.hostname
    const domain = host === 'mithril.fund' || host.endsWith('.mithril.fund') ? ';Domain=mithril.fund;Secure' : ''
    document.cookie = `mf_locale=${encodeURIComponent(locale)};Path=/;Max-Age=31536000;SameSite=Lax${domain}`
  }, [locale])
  useEffect(() => {
    const onPopState = () => setState(initialLocale())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const setLocale = useCallback((next: TwinLocale) => {
    setState(next)
    const url = new URL(window.location.href)
    url.searchParams.set('lang', next)
    window.history.replaceState(window.history.state, '', url)
  }, [])
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale])
  return <LocaleContext.Provider value={value}>
    {locale !== 'en' && <p className="twin-fallback" data-locale-fallback lang={locale}>
      {(fallbackNotice as Record<string, string>)[locale] ?? 'Some content is available in English only.'}
    </p>}
    <div className="twin-language-bar">
      <label htmlFor="twin-language" className="sr-only">{locale === 'ja' ? '言語' : 'Language'}</label>
      <select id="twin-language" aria-label={locale === 'ja' ? '言語' : 'Language'} value={locale} onChange={(event) => setLocale(event.target.value as TwinLocale)}>
        {LOCALES.map((code) => <option key={code} value={code}>{names[code]}</option>)}
      </select>
    </div>
    {children}
  </LocaleContext.Provider>
}
