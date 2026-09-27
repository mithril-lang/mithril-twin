import { THEME_LIST, type ThemeId } from '../themes/index'
import { useTheme } from '../themes/ThemeContext'

export default function ThemeSwitcher() {
  const { themeId, setThemeId } = useTheme()
  return (
    <div className="theme-switcher" role="group" aria-label="Theme">
      <span className="chrome-label">Theme</span>
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
