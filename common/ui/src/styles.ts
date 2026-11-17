// The design's shared stylesheet, emitted inline and verbatim so every page renders exactly as the approved
// mockups: base rules first, then the page's own rules, then the mobile rules, then the page's tail.
import font from './assets/kumbh.ttf?url';
import noise from './assets/noise.png?url';
import base from './styles/base.css?raw';
import langbar from './styles/langbar.css?raw';
import mobile from './styles/mobile.css?raw';

export const BASE_CSS = base.replace('%FONT%', font).replace('%NOISE%', noise);
export const MOBILE_CSS = mobile;
export const LANGBAR_CSS = langbar;

/** One `<style>` element in the design's cascade order. */
export function stylesheet(head: readonly string[], tail: readonly string[]): string {
  return `<style>${BASE_CSS}${head.join('')}${MOBILE_CSS}${tail.join('')}${LANGBAR_CSS}</style>`;
}
