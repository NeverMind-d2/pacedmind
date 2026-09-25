'use client';

import { create } from '@orama/orama';
import { useDocsSearch } from 'fumadocs-core/search/client';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search';
import { useI18n } from 'fumadocs-ui/contexts/i18n';

/**
 * Orama's language for each docs locale. It must match `localeMap` in
 * src/app/api/search/route.ts. Fumadocs' built-in static dialog passes the
 * locale code ("en") to Orama, which only knows names ("english"), so its
 * search stays empty; this dialog gives Orama the name instead.
 */
const ORAMA_LANGUAGE: Record<string, string> = { en: 'english' };

function initOrama(locale?: string) {
  return create({ schema: { _: 'string' }, language: ORAMA_LANGUAGE[locale ?? 'en'] ?? 'english' });
}

/** Static search: loads the index the build wrote to /docs/api/search and searches it in the browser. */
export default function StaticSearchDialog(props: SharedProps) {
  const { locale } = useI18n();
  const { search, setSearch, query } = useDocsSearch({
    type: 'static',
    from: '/docs/api/search',
    locale,
    initOrama,
  });

  return (
    <SearchDialog search={search} onSearchChange={setSearch} isLoading={query.isLoading} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data !== 'empty' ? query.data : null} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
