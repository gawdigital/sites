// Hatched pills laid out in the frame's own coordinates, as the design places them behind the cards of a long page:
// a group is given as the design gives it, `[x, top, bottom]` per pill, and becomes a drawing with its own origin
// and the position that puts it back.
export type Pill = readonly [x: number, top: number, bottom: number];

export interface Group {
  pills: Pill[];
  /** Where the drawing sits: `left`, `top`, `width` and `height`. */
  style: string;
}

/**
 * @param pills the group in frame coordinates
 * @param width a pill's width
 * @param centered whether x is measured in the centred 1440 px page (the desktop) or from the frame's edge (the phone)
 */
export function place(pills: readonly Pill[], width: number, centered = false): Group {
  const left = Math.min(...pills.map(([x]) => x));
  const top = Math.min(...pills.map(([, y]) => y));
  const w = Math.max(...pills.map(([x]) => x)) - left + width;
  const h = Math.max(...pills.map(([, , bottom]) => bottom)) - top;
  const x = centered ? `calc(50% - ${720 - left}px)` : `${left}px`;
  return {
    pills: pills.map(([px, y, bottom]) => [px - left, y - top, bottom - top] as const),
    style: `left:${x};top:${top}px;width:${w}px;height:${h}px`,
  };
}
