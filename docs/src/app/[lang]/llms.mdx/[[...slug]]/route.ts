import { getLLMText, getPageMarkdownUrl, source } from '@/lib/source';
import { notFound } from 'next/navigation';

export const dynamic = 'force-static';
export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: RouteContext<'/[lang]/llms.mdx/[[...slug]]'>,
) {
  const { slug, lang } = await params;
  const page = source.getPage(slug?.slice(0, -1), lang);
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
    },
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    lang: page.locale ?? 'en',
    slug: getPageMarkdownUrl(page).segments,
  }));
}
