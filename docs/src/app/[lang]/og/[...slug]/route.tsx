import fs from 'node:fs';
import path from 'node:path';
import { getPageImage, source } from '@/lib/source';
import { notFound } from 'next/navigation';
import { ImageResponse } from 'next/og';

export const dynamic = 'force-static';
export const revalidate = false;

// The pd emblem (a white pd on a black tile), as on pacedmind.com.
const emblem = `data:image/svg+xml;base64,${fs
  .readFileSync(path.join(process.cwd(), 'public', 'brand', 'emblem.svg'))
  .toString('base64')}`;

export async function GET(
  _req: Request,
  { params }: RouteContext<'/[lang]/og/[...slug]'>,
) {
  const { slug, lang } = await params;
  const page = source.getPage(slug.slice(0, -1), lang);
  if (!page) notFound();

  return new ImageResponse(
    (
      // The app's dark palette: near-black, neutral grays, a navy line for the accent.
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          padding: '72px 80px',
          backgroundColor: '#010101',
          color: '#ededef',
          borderBottom: '14px solid #2e4b91',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '22px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={emblem} width={64} height={64} alt="" style={{ borderRadius: '14px', border: '2px solid #1b1b1e' }} />
          <span style={{ fontSize: '34px', color: '#a1a1a8' }}>PacedMind Docs</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
          <p style={{ fontSize: '76px', fontWeight: 700, lineHeight: 1.1, margin: 0 }}>{page.data.title}</p>
          {page.data.description && (
            <p style={{ fontSize: '34px', lineHeight: 1.35, color: '#a1a1a8', margin: '24px 0 0' }}>
              {page.data.description}
            </p>
          )}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}

export function generateStaticParams() {
  return source.getPages().flatMap((page) =>
    page
      ? [
          {
            lang: page.locale ?? 'en',
            slug: getPageImage(page).segments,
          },
        ]
      : [],
  );
}
