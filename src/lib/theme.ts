export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "pacedmind-theme";

declare global {
  interface Window {
    pacedMindDesktop?: {
      initialTheme: Theme;
      setTheme: (theme: Theme) => void;
    };
  }
}

// Runs before the first paint, including when local storage is unavailable.
export const THEME_INIT_SCRIPT = `(() => {
  let theme = window.pacedMindDesktop?.initialTheme || 'dark';
  try { const saved = localStorage.getItem('${THEME_STORAGE_KEY}'); if (saved === 'light' || saved === 'dark') theme = saved; } catch {}
  document.documentElement.dataset.theme = theme;
})();`;
