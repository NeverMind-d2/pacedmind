import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import type * as PageTree from 'fumadocs-core/page-tree';

function transformTree(items: PageTree.Node[]): PageTree.Node[] {
  return items.map((item) => {
    if (item.type === 'folder') {
      // If folder has an index and no sub-pages, render it as a simple Page
      if (item.children.length === 0 && item.index) {
        return {
          ...item.index,
          type: 'page',
          name: item.name,
        };
      }

      return {
        ...item,
        children: transformTree(item.children),
      };
    }

    return item;
  });
}

export default async function Layout({ children, params }: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  const originalTree = source.getPageTree(lang);
  const tree: PageTree.Root = {
    ...originalTree,
    children: transformTree(originalTree.children),
  };

  return (
    <DocsLayout tree={tree} {...baseOptions()}>
      {children}
    </DocsLayout>
  );
}
