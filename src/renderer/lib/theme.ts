export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'anssh-theme';
const LEGACY_KEY = 'nexterm-theme';

export function getStoredTheme(): Theme | null {
  try {
    let v = localStorage.getItem(STORAGE_KEY);
    if (!v) v = localStorage.getItem(LEGACY_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* private mode */
  }
  return null;
}

/** Sync `dark` class on `<html>` with the selected theme */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* */
  }
}
