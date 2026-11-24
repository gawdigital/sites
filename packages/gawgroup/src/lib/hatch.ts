// Hatched pills as the design places them behind the phone's cards: a group is given as the design gives it, in the
// 390 px frame's coordinates, `[x, top, bottom]` per pill, and becomes a drawing with its own origin, hung from the
// box it belongs to.
export type Pill = readonly [x: number, top: number, bottom: number];

export interface Group {
  pills: Pill[];
  /** Where the drawing sits in its box: `left` or `right`, `top`, `width` and `height`. */
  style: string;
}

/** The edge of the box a group hangs from, and where that edge lies in the design's frame. */
export type Edge<E extends string> = readonly [edge: E, at: number];

const plus = (n: number) => (n < 0 ? `- ${-n}px` : `+ ${n}px`);

/**
 * A group hung from the box it belongs to (its containing block): it keeps the design's offset from that box's top or
 * bottom edge and from its left or right edge, so it moves with the box however the text wraps, at any width and
 * while the window is resized. At the design's width it lands exactly where the design has it.
 * @param pills the group in frame coordinates
 * @param width a pill's width
 * @param y the box's edge the group hangs from, and where that edge is in the design's frame
 * @param x the box's side the group keeps its distance from, and where that side is in the design's frame
 */
export function hang(
  pills: readonly Pill[],
  width: number,
  [yEdge, y]: Edge<'top' | 'bottom'>,
  [xEdge, x]: Edge<'left' | 'right'>,
): Group {
  const left = Math.min(...pills.map(([px]) => px));
  const top = Math.min(...pills.map(([, t]) => t));
  const w = Math.max(...pills.map(([px]) => px)) - left + width;
  const h = Math.max(...pills.map(([, , bottom]) => bottom)) - top;
  const horizontal = xEdge === 'left' ? `left:${left - x}px` : `right:${x - (left + w)}px`;
  const vertical = yEdge === 'top' ? `top:${top - y}px` : `top:calc(100% ${plus(top - y)})`;
  return {
    pills: pills.map(([px, t, bottom]) => [px - left, t - top, bottom - top] as const),
    style: `${horizontal};${vertical};width:${w}px;height:${h}px`,
  };
}
