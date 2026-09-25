import type { CSSProperties } from "react";
import { UNFOLD, WORDMARK, letterDelay } from "@/lib/brand";
// Imported rather than linked, so its URL carries a content hash and can be cached for good. Not
// preloaded: at high priority it held back the first paint in Lighthouse, and with the CSS inline
// the browser reaches the SVG early anyway.
import artwork from "@/public/brand/wordmark.png";

const TRAVEL: CSSProperties = {
  animationDelay: `${UNFOLD.delay}ms`,
  animationDuration: `${UNFOLD.duration}ms`,
  animationTimingFunction: `cubic-bezier(${UNFOLD.easing.join(", ")})`,
};

/**
 * The approved wordmark artwork, drawn in the current text color through an alpha mask, so the
 * letter shapes stay exact. With `unfold`, it opens from the pd emblem into the full name. The name
 * is also there as text, for screen readers and for crawlers, which don't read an SVG's label.
 */
export function Wordmark({ id, unfold = false, className }: { id: string; unfold?: boolean; className?: string }) {
  const { width, height, letters, tailShift } = WORDMARK;
  const mask = `url(#${id})`;
  const last = letters.length - 1;
  return (
    <>
      <span className="sr-only">PacedMind</span>
      <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" fill="currentColor" overflow="visible" className={className}>
        <defs>
          <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height} style={{ maskType: "alpha" }}>
            <image href={artwork.src} width={width} height={height} />
          </mask>
        </defs>
        {unfold ? letters.map(({ letter, left, right }, index) => (
          // Each letter is its own group, so the last d can travel while the others fade in.
          <g key={`${letter}${index}`}
            className={index === 0 ? undefined : index === last ? "unfold-tail" : "unfold-letter"}
            style={index === last
              ? ({ ...TRAVEL, "--shift": `${tailShift}px` } as CSSProperties)
              : index > 0 ? { animationDelay: `${letterDelay(left, right)}ms`, animationDuration: `${UNFOLD.fade}ms` } : undefined}>
            <rect x={left} y="0" width={right - left} height={height} mask={mask} />
          </g>
        )) : <rect width={width} height={height} mask={mask} />}
      </svg>
    </>
  );
}
