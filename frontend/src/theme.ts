export type DisplayTheme = 'dark' | 'light';

const preview = new URLSearchParams(window.location.search).get('theme');
export const themeQuery = preview === 'dark' || preview === 'light' ? `?theme=${preview}` : '';

export function displayTheme(configured?: DisplayTheme): DisplayTheme {
  return preview === 'dark' || preview === 'light' ? preview : configured ?? 'dark';
}
