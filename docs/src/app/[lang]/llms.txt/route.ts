import type * as PageTree from 'fumadocs-core/page-tree';
import { publicUrl, source } from '@/lib/source';
import { i18n } from '@/lib/i18n';
import { docsUrl, siteUrl } from '@/lib/shared';

export const dynamic = 'force-static';
export const revalidate = false;

/**
 * The llms.txt index (https://llmstxt.org): every page with its description, grouped
 * like the sidebar. Fumadocs' llms() helper writes links relative to the site root
 * (/getting-started), which would resolve outside /docs, so this writes absolute URLs.
 */
export async function GET(_req: Request, { params }: RouteContext<'/[lang]/llms.txt'>) {
  const { lang } = await params;
  const prefix = lang === i18n.defaultLanguage ? '' : `/${lang}`;
  const out = [
    '# PacedMind Docs',
    '',
    '> User guide for PacedMind, a personal planner for tasks, time blocks, a calendar and deadlines that also starts Claude Code and Codex sessions in the user\'s terminals and tracks them over an MCP server.',
    '',
    `The whole guide in one file: ${docsUrl}${prefix}/llms-full.txt`,
    `Each page as Markdown: ${docsUrl}${prefix}/llms.mdx/<page path>/content.md`,
    `What PacedMind is, its plans and downloads: ${siteUrl}/llms.txt`,
    '',
  ];
  for (const node of source.getPageTree(lang).children) {
    if (node.type === 'folder') {
      out.push(`## ${title(node, lang)}`, '');
      const pages: PageTree.Node[] = [...(node.index ? [node.index] : []), ...node.children];
      for (const child of pages) out.push(...lines(child, lang, 0));
      out.push('');
    } else {
      out.push(...lines(node, lang, 0), '');
    }
  }
  return new Response(out.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function title(node: PageTree.Node, lang: string): string {
  if (node.type === 'page') return source.getNodePage(node, lang)?.data.title ?? String(node.name);
  if (node.type === 'folder') return source.getNodeMeta(node, lang)?.data.title ?? String(node.name);
  return String(node.name ?? '');
}

function lines(node: PageTree.Node, lang: string, depth: number): string[] {
  const indent = '  '.repeat(depth);
  if (node.type === 'page') {
    const page = source.getNodePage(node, lang);
    if (!page) return [];
    const link = `[${page.data.title}](${publicUrl(lang, page.slugs)})`;
    return [`${indent}- ${link}${page.data.description ? `: ${page.data.description}` : ''}`];
  }
  if (node.type === 'folder') {
    const children = [...(node.index ? [node.index] : []), ...node.children];
    // A sub-folder (e.g. the MCP tool reference) becomes a nested list under its name.
    const head = node.index ? [] : [`${indent}- ${title(node, lang)}`];
    return [...head, ...children.flatMap((c) => lines(c, lang, node.index ? depth : depth + 1))];
  }
  return [];
}

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}
