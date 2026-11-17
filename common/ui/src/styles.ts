// The design's shared stylesheet, emitted inline and verbatim so every page renders exactly as the approved
// mockups: base rules first, then the page's own rules, then the mobile rules, then the page's tail.
import font from './assets/kumbh.ttf?url';
import noise from './assets/noise.png?url';
import dither from './assets/dither.png?url';
import base from './styles/base.css?raw';
import mobile from './styles/mobile.css?raw';

/** The design's width: the desktop layout is drawn for a 1680 px window. */
const DESIGN_WIDTH = 1680;

/**
 * Between the mobile layout and the design's width, the frame is zoomed out in 20 px steps, so the desktop layout
 * fits the window instead of running off its right edge. Each step zooms to the width at its bottom, so the frame is
 * never wider than the window; its height keeps filling the window.
 */
function narrowDesktop(): string {
  const rules: string[] = [];
  for (let w = DESIGN_WIDTH; w > 700; w -= 20) {
    const zoom = +((w - 20) / DESIGN_WIDTH).toFixed(4);
    rules.push(`@media (min-width:701px) and (max-width:${w - 0.02}px){.frame{zoom:${zoom};min-height:calc(100vh / ${zoom})}}`);
  }
  return rules.join('\n');
}

export const BASE_CSS = `${base.replace('%FONT%', font).replace('%NOISE%', noise).replace('%DITHER%', dither)}\n${narrowDesktop()}`;
export const MOBILE_CSS = mobile;

/** One `<style>` element in the design's cascade order. */
export function stylesheet(head: readonly string[], tail: readonly string[]): string {
  return `<style>${BASE_CSS}${head.join('')}${MOBILE_CSS}${tail.join('')}</style>`;
}
