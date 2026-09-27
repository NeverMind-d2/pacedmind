import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { gitConfig, repoUrl, siteUrl } from './shared';
import { NavTitle } from '@/components/NavTitle';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: NavTitle,
    },
    links: [
      {
        type: 'custom',
        secondary: true,
        children: (
          <a
            href={`${siteUrl}/`}
            className="flex items-center justify-center gap-2 rounded-md bg-brand px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand/90"
          >
            Get PacedMind
          </a>
        ),
      },
    ],
    ...(gitConfig.repoPublic && { githubUrl: repoUrl }),
  };
}
