"use client";

import { useId, type CSSProperties } from "react";
import geometry from "@/lib/brand-geometry.json";

/** Animates the actual approved artwork, without substituting a different typeface. */
export function BrandWordmark({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const maskId = `${id}-ink`;
  const filterId = `${id}-invert`;
  return (
    <svg
      className={`brand-wordmark ${className}`}
      viewBox={geometry.viewBox}
      role="img"
      aria-label="PacedMind"
      fill="currentColor"
    >
      <defs>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0" />
        </filter>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={geometry.imageWidth} height={geometry.imageHeight} style={{ maskType: "luminance" }}>
          <image href="/brand/pacedmind-wordmark.png" width={geometry.imageWidth} height={geometry.imageHeight} filter={`url(#${filterId})`} />
        </mask>
      </defs>
      {geometry.letters.map(({ letter, left, right }, index) => (
          <g key={`${letter}-${index}`}
            className={index === 0 ? undefined : index === geometry.letters.length - 1 ? "brand-wordmark__tail" : "brand-wordmark__letter"}
            style={{ "--letter-delay": `${350 + index * 65}ms`, "--letter-start": `${geometry.letters[0].left - left}px` } as CSSProperties}
          >
            <rect x={left} y="255" width={right - left} height="298" mask={`url(#${maskId})`} />
          </g>
      ))}
    </svg>
  );
}
