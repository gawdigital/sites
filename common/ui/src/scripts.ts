// The design's interactivity is a handful of small plain scripts, inlined into each prerendered page: no
// hydration, no client bundle. Every page works without them.
import hatch from './scripts/hatch.js?raw';
import langbar from './scripts/langbar.js?raw';
import menu from './scripts/menu.js?raw';
import theme from './scripts/theme.js?raw';
import themeHead from './scripts/theme-head.js?raw';

export const THEME_HEAD = themeHead;
export const THEME = theme;
export const MENU = menu;
export const HATCH = hatch;
export const LANGBAR = langbar;

/** A script element around trusted, inline source. */
export function inline(...sources: string[]): string {
  return sources.map((s) => `<script>${s}</script>`).join('');
}
