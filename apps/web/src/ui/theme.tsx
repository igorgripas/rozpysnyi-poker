import { type ReactNode, createContext, use, useEffect, useState } from 'react';
import { uk } from '../i18n';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'poker.theme';

function storedTheme(): Theme | null {
  const value = localStorage.getItem(THEME_STORAGE_KEY);
  return value === 'light' || value === 'dark' ? value : null;
}

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Тема інтерфейсу: вибір гравця (localStorage) або тема системи. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => storedTheme() ?? systemTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = (next: Theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, next);
    setThemeState(next);
  };

  return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const value = use(ThemeContext);
  if (value === null) throw new Error('useTheme потребує ThemeProvider');
  return value;
}

/** Кнопка перемикання світлої й темної теми. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? uk.theme.toDark : uk.theme.toLight;
  return (
    <button
      type="button"
      className="settings__item"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
    >
      <span aria-hidden="true">{next === 'dark' ? '☾' : '☀'}</span>
      {label}
    </button>
  );
}
