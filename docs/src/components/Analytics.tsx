'use client';

import { useEffect } from 'react';
import { analytics } from '@/lib/shared';

/** Loads Umami's tracker (`analytics` in lib/shared.ts) on the live site only. It sets no cookies. */
export function Analytics() {
  useEffect(() => {
    if (!analytics.websiteId || location.hostname !== analytics.hostname) return;
    const script = document.createElement('script');
    script.src = analytics.script;
    script.defer = true;
    script.dataset.websiteId = analytics.websiteId;
    document.head.appendChild(script);
  }, []);
  return null;
}
