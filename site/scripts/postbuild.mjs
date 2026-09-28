// Finishes the static export in out/ after `next build` (npm run build runs it).
//
// Repairs the router's prefetch files when the build ran on Windows. Next writes one file per page segment, named
// like `__next.privacy.__PAGE__.txt`, but on Windows the segment path keeps its backslashes and ends up as nested
// folders (`__next.privacy\__PAGE__.txt`). The browser asks for the dotted name, gets a 404 and falls back to the
// page's full payload. Navigation still works, only slower, so this renames them to what the browser asks for. The
// docs do the same (docs/scripts/postbuild.mjs). A build elsewhere has nothing to repair.
import fs from "node:fs";
import path from "node:path";

const out = path.resolve(import.meta.dirname, "..", "out");
if (!fs.existsSync(out)) throw new Error(`No ${out}. Run next build first.`);

let renamed = 0;

/** Every file below `dir`, as paths relative to it. */
function filesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesIn(path.join(dir, e.name)).map((f) => path.join(e.name, f)) : [e.name],
  );
}

function repairSegments(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "_next") continue;
    const folder = path.join(dir, entry.name);
    if (!entry.name.startsWith("__next.")) {
      repairSegments(folder);
      continue;
    }
    for (const file of filesIn(folder)) {
      const dotted = `${entry.name}.${file.split(path.sep).join(".")}`;
      fs.renameSync(path.join(folder, file), path.join(dir, dotted));
      renamed++;
    }
    fs.rmSync(folder, { recursive: true });
  }
}

repairSegments(out);
if (renamed) console.log(`Renamed ${renamed} prefetch files written as folders on Windows.`);
