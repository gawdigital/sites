// Inline SVG markup shared by the sites, kept verbatim from the approved design.

/** The arrow after a "go" link. */
export const ARROW = "<svg viewBox=\"0 0 22 14\" width=\"22\" height=\"14\"><path d=\"M1 7h18M13 1.5 19.5 7 13 12.5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";

/** The arrow after a link that opens in a new tab. */
export const EXT = "<svg viewBox=\"0 0 16 16\" width=\"16\" height=\"16\"><path d=\"M3.5 12.5 12.5 3.5M5.5 3.5h7v7\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";

/** The theme button, day. */
export const SUN = "<svg class=\"sun\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\"><circle cx=\"12\" cy=\"12\" r=\"4.5\" fill=\"currentColor\"/><path d=\"M12 1.5v2.5M12 20v2.5M1.5 12h2.5M20 12h2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8\"/></svg>";

/** The theme button, night. */
export const MOON = "<svg class=\"moon\" viewBox=\"0 0 24 24\"><path fill=\"currentColor\" d=\"M20.5 14.8A9 9 0 0 1 9.2 3.5a9 9 0 1 0 11.3 11.3z\"/></svg>";

/** The mobile menu button. */
export const DOTS = "<svg viewBox=\"0 0 37 8\" aria-hidden=\"true\" focusable=\"false\"><g fill=\"currentColor\"><circle cx=\"3.5\" cy=\"4\" r=\"3.2\"/><circle cx=\"18.5\" cy=\"4\" r=\"3.2\"/><circle cx=\"33.5\" cy=\"4\" r=\"3.2\"/></g></svg>";

/** The mobile menu close button. */
export const CROSS = "<svg viewBox=\"0 0 22 22\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M3 3l16 16M19 3 3 19\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.6\" stroke-linecap=\"round\"/></svg>";

/** The sent state of a form. */
export const CHECK = "<svg viewBox=\"0 0 72 72\" aria-hidden=\"true\"><circle cx=\"36\" cy=\"36\" r=\"31\" fill=\"none\" style=\"stroke:url(#xg)\" stroke-width=\"4.5\"/><path d=\"M23 37 L32 46 L50 27\" fill=\"none\" style=\"stroke:url(#xg)\" stroke-width=\"5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";

/** A copy button: the copy icon and the copied tick. */
export const COPY = "<svg class=\"ic\" viewBox=\"0 0 16 16\" aria-hidden=\"true\"><rect x=\"5\" y=\"5\" width=\"9\" height=\"9\" rx=\"2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"/><path d=\"M11 3.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h.5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/></svg><svg class=\"ok\" viewBox=\"0 0 16 16\" aria-hidden=\"true\"><path d=\"M2.5 8.5l3.5 3.5 7.5-8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";

/** The gradients the pages paint with (xg, xgv, bg), once per page. */
export const GRADIENTS = "<svg width=\"0\" height=\"0\" style=\"position:absolute\" aria-hidden=\"true\"><defs><linearGradient id=\"xg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" style=\"stop-color:var(--g1)\"/><stop offset=\"1\" style=\"stop-color:var(--g2)\"/></linearGradient><linearGradient id=\"xgv\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" style=\"stop-color:var(--g1)\"/><stop offset=\"1\" style=\"stop-color:var(--g2)\"/></linearGradient><linearGradient id=\"bg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" style=\"stop-color:var(--b1)\"/><stop offset=\"1\" style=\"stop-color:var(--b2)\"/></linearGradient></defs></svg>";

/** The background blob behind the header. */
export const BLOB_PATH = "M 0 200.068 C 318 -126.932 1362.001 -79.096 1680.001 537.904 L 1680.001 882.5 C 1322 2255.5 236 2832 0 1276 L 0 200.068 Z";
