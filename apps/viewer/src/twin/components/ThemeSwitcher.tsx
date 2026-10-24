import { THEME_LIST, type ThemeId } from '../themes/index'
import { useTheme } from '../themes/ThemeContext'
import { useViewerLocale } from '../../locale'
import { twinCopy } from '../twin-copy'

export default function ThemeSwitcher() {
  const { themeId, setThemeId } = useTheme()
  const locale = useViewerLocale()
  return (
    <div className="theme-switcher" role="group" aria-label={twinCopy(locale, 'Theme')}>
      <span className="chrome-label">{twinCopy(locale, 'Theme')}</span>
      {THEME_LIST.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`chrome-btn ${themeId === t.id ? 'active' : ''}`}
          onClick={() => setThemeId(t.id as ThemeId)}
          title={t.description}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
