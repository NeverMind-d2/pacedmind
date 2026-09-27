'use client';

import { useId, type ComponentProps } from 'react';
import { siteUrl } from '@/lib/shared';

/** Size of public/brand/wordmark.png (the site's copy of the approved wordmark, ink as alpha). */
const WORDMARK = { width: 1819, height: 298 };

/**
 * The docs navbar logo: the approved wordmark, drawn in the current text color
 * through an alpha mask (like ../site/components/wordmark.tsx), so it follows the
 * theme. Links to the home page in the same tab; Fumadocs' default Link wrapper
 * would open external URLs in a new one.
 */
export function NavTitle({ className }: ComponentProps<'a'>) {
  const { width, height } = WORDMARK;
  // Fumadocs renders the title twice (sidebar and mobile bar). Each copy needs its own mask id:
  // with a shared one, both would use the first, which is hidden on one of the layouts.
  const mask = `nav-wordmark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <a href={`${siteUrl}/`} className={className}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="PacedMind" fill="currentColor" className="h-[18px] w-auto">
        <defs>
          <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height} style={{ maskType: 'alpha' }}>
            <image href="/docs/brand/wordmark.png" width={width} height={height} />
          </mask>
        </defs>
        <rect width={width} height={height} mask={`url(#${mask})`} />
      </svg>
      <span className="text-sm font-medium text-fd-muted-foreground">Docs</span>
      <span className="sr-only">PacedMind documentation</span>
    </a>
  );
}
