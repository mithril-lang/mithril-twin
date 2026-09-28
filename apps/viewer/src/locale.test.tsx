import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LOCALES, TwinLocaleProvider } from './locale'

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
  document.cookie = 'mf_locale=;Path=/;Max-Age=0'
})

describe('Twin language selection', () => {
  it('offers all 22 public locales and preserves the sample document in the query', () => {
    window.history.replaceState(null, '', '/mithril-twin/?doc=polaris-enterprise&lang=ar')
    render(<TwinLocaleProvider><div>viewer</div></TwinLocaleProvider>)
    const selector = screen.getByRole('combobox', { name: 'Language' }) as HTMLSelectElement
    expect(selector.options).toHaveLength(LOCALES.length)
    expect(selector.value).toBe('ar')
    expect(document.documentElement.dir).toBe('rtl')
    expect(screen.getByText('بعض المحتوى متاح باللغة الإنجليزية فقط.')).toBeTruthy()
    fireEvent.change(selector, { target: { value: 'ja' } })
    expect(window.location.search).toContain('doc=polaris-enterprise')
    expect(window.location.search).toContain('lang=ja')
    expect(document.cookie).toContain('mf_locale=ja')
    expect(document.documentElement.dir).toBe('ltr')
  })

  it('uses the cookie when the query does not specify a locale', () => {
    document.cookie = 'mf_locale=he;Path=/'
    render(<TwinLocaleProvider><div>viewer</div></TwinLocaleProvider>)
    expect((screen.getByRole('combobox', { name: 'Language' }) as HTMLSelectElement).value).toBe('he')
    expect(document.documentElement.dir).toBe('rtl')
  })
})
