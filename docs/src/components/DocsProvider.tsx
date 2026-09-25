'use client';

import { FrameworkProvider, type Framework } from 'fumadocs-core/framework';
import { RootProvider, type RootProviderProps } from 'fumadocs-ui/provider/base';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { i18n } from '@/lib/i18n';

/**
 * The path the sidebar, the breadcrumbs and the page footer match pages against, without the
 * default language's prefix. The static export renders English pages under /en/..., and
 * scripts/postbuild.mjs serves them without it: with Next's own pathname the server would render
 * /en/views/timeline (no folder open, no page active) and the browser /views/timeline, and React
 * would fail to hydrate the page (error #418) and render it again.
 */
function useDocsPathname(): string {
  const pathname = usePathname();
  const prefix = `/${i18n.defaultLanguage}`;
  if (pathname === prefix) return '/';
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname;
}

// next/link and next/image, as fumadocs-core's NextProvider passes them; their props types are
// stricter than Fumadocs' own (href and src are required).
const NextLink = Link as unknown as NonNullable<Framework['Link']>;
const NextImage = Image as unknown as NonNullable<Framework['Image']>;

/** Fumadocs' RootProvider for Next.js (fumadocs-ui/provider/next), with that pathname. */
export function DocsProvider(props: RootProviderProps) {
  return (
    <FrameworkProvider usePathname={useDocsPathname} useParams={useParams} useRouter={useRouter} Link={NextLink} Image={NextImage}>
      <RootProvider {...props} />
    </FrameworkProvider>
  );
}
