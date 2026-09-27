import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { THEMES, applyThemeToDom, getTheme, type ThemeId, type ThemeTokenSet } from './index'

type ThemeCtx = {
  themeId: ThemeId
  theme: ThemeTokenSet
  setThemeId: (id: ThemeId) => void
}

const Ctx = createContext<ThemeCtx | null>(null)
const STORAGE_KEY = 'polaris-twin-theme'

function readSavedTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'make-light' || saved === 'make') return 'make'
    if (saved && saved in THEMES) return saved as ThemeId
  } catch {
    /* private mode */
  }
  return 'make'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemeId>(readSavedTheme)

  const theme = useMemo(() => getTheme(themeId), [themeId])

  useLayoutEffect(() => {
    applyThemeToDom(theme)
    try {
      localStorage.setItem(STORAGE_KEY, themeId)
    } catch {
      /* ignore */
    }
  }, [theme, themeId])

  useEffect(() => () => {
    document.documentElement.removeAttribute('data-theme')
  }, [])

  const setThemeId = (id: ThemeId) => setThemeIdState(id)

  return <Ctx.Provider value={{ themeId, theme, setThemeId }}>{children}</Ctx.Provider>
}

export function useTheme() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
