// Finishes the static export in out/ after `next build` (npm run build runs it).
//
// 1. Moves the default language's pages from out/<lang>/ to the root of out/.
//    The docs use `hideLocale: 'default-locale'`: English pages have no language prefix
//    (/docs/views/today, not /docs/en/views/today), and every link Fumadocs renders is written
//    that way. A Next.js server does this with a proxy that rewrites the URL; a static export
//    has no proxy, so the files move instead. Other languages keep their folder (out/pl/...).
//    `next dev` gets the same URLs from the rewrite in next.config.mjs.
//
// 2. Repairs the router's prefetch files when the build ran on Windows. Next writes one file per
//    page segment, named like `__next.$d$lang.!KGRvY3Mp.$c$slug.__PAGE__.txt`, but on Windows the
//    segment path keeps its backslashes and ends up as nested folders (`__next.$d$lang\...`).
//    The browser asks for the dotted name, gets a 404 and falls back to the page's full payload.
//    Navigation still works, only slower, so this renames them to what the browser asks for.
import fs from 'node:fs';
import path from 'node:path';

// Keep in step with `i18n` in src/lib/i18n.ts and next.config.mjs.
const defaultLanguage = 'en';

const out = path.resolve(import.meta.dirname, '..', 'out');
const from = path.join(out, defaultLanguage);
if (!fs.existsSync(out)) throw new Error(`No ${out}. Run next build first.`);
if (!fs.existsSync(from)) throw new Error(`No ${from}: the build has no pages for "${defaultLanguage}".`);

/* ---------- 1. the default language at the root ---------- */

let moved = 0;

/** Moves one file or folder into place, merging folders and refusing to overwrite a file. */
function move(src, dest) {
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) move(path.join(src, name), path.join(dest, name));
    fs.rmdirSync(src);
    return;
  }
  if (fs.existsSync(dest)) {
    throw new Error(`${path.relative(out, dest)} exists already; a page's slug collides with a file at the root of out/.`);
  }
  fs.renameSync(src, dest);
  moved++;
}

// The language's own page (/en) becomes the docs home (/), next to its folder.
for (const file of fs.readdirSync(out).filter((n) => n.startsWith(`${defaultLanguage}.`))) {
  move(path.join(out, file), path.join(out, `index${file.slice(defaultLanguage.length)}`));
}
move(from, out);
console.log(`Moved ${moved} files of the default language (${defaultLanguage}) to the root of out/.`);

/* ---------- 2. prefetch files from a Windows build ---------- */

let renamed = 0;

/** Every file below `dir`, as paths relative to it. */
function filesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesIn(path.join(dir, e.name)).map((f) => path.join(e.name, f)) : [e.name],
  );
}

function repairSegments(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '_next') continue;
    const folder = path.join(dir, entry.name);
    if (!entry.name.startsWith('__next.')) {
      repairSegments(folder);
      continue;
    }
    for (const file of filesIn(folder)) {
      const dotted = `${entry.name}.${file.split(path.sep).join('.')}`;
      fs.renameSync(path.join(folder, file), path.join(dir, dotted));
      renamed++;
    }
    fs.rmSync(folder, { recursive: true });
  }
}

repairSegments(out);
if (renamed) console.log(`Renamed ${renamed} prefetch files written as folders on Windows.`);
