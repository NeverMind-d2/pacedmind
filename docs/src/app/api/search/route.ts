import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// Static search: `next build` writes the whole index to /docs/api/search as a
// file, and the search dialog loads it and searches in the browser.
export const dynamic = 'force-static';
export const revalidate = false;

export const { staticGET: GET } = createFromSource(source, {
  localeMap: {
    en: { language: 'english' },
  },
});
