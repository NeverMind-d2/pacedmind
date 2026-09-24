/**
 * The approved wordmark (public/brand/wordmark.png) is the app's public/brand/pacedmind-wordmark.png
 * cropped to the letters, with the ink as alpha. Letter bounds are in the image's pixels.
 */
export const WORDMARK = {
  width: 1819,
  height: 298,
  letters: [
    { letter: "p", left: 2, right: 182 },
    { letter: "a", left: 203, right: 382 },
    { letter: "c", left: 419, right: 569 },
    { letter: "e", left: 600, right: 775 },
    { letter: "d", left: 802, right: 977 },
    { letter: "m", left: 1021, right: 1297 },
    { letter: "i", left: 1353, right: 1379 },
    { letter: "n", left: 1438, right: 1602 },
    { letter: "d", left: 1644, right: 1816 },
  ],
  // Moves the last d so its bowl sits on the p's bowl (both centred at y 142; p at x 95, d at x 1727).
  // The two letters then read as the pd emblem: one bowl, a stem down on the left and up on the right.
  tailShift: -1632,
};

/** The intro: the pd emblem holds, then the d travels right and each letter appears as it passes. */
export const UNFOLD = { delay: 500, duration: 1600, easing: [0.65, 0, 0.35, 1] as const, fade: 450 };

/** When the eased animation reaches `progress`, as a fraction of its duration. */
function timeAt(progress: number, [x1, y1, x2, y2]: readonly number[]) {
  const bezier = (a: number, b: number, s: number) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s ** 2 * b + s ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (bezier(y1, y2, mid) < progress) lo = mid;
    else hi = mid;
  }
  return bezier(x1, x2, (lo + hi) / 2);
}

/** Milliseconds after page load at which the travelling d passes a letter's centre. */
export function letterDelay(left: number, right: number) {
  const tail = WORDMARK.letters[WORDMARK.letters.length - 1];
  const start = tail.left + WORDMARK.tailShift;
  const progress = ((left + right) / 2 - start) / -WORDMARK.tailShift;
  return Math.round(UNFOLD.delay + timeAt(progress, UNFOLD.easing) * UNFOLD.duration);
}
