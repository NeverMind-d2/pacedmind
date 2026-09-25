import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { dataDir } from "./device";

/*
 * Image files that agents attach, such as screenshots of their result. The files stay on the computer the agent
 * saved them on, in the app's data folder; their rows live in the cloud (repo.ts), which records the computer.
 */

/** Where this computer keeps the images agents attach, next to the app's other data. */
export const attachmentsDir = () => path.join(dataDir(), "attachments");

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface StoredImage {
  id: string;
  file: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
}

/** A problem with an image the agent can fix, such as a wrong path. */
export class ImageError extends Error {}

type Kind = { mime: string; ext: string; size: (b: Buffer) => [number, number] | null };

const be16 = (b: Buffer, i: number) => b.readUInt16BE(i);
const le16 = (b: Buffer, i: number) => b.readUInt16LE(i);
const le24 = (b: Buffer, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/** Walks a JPEG's segments to the frame header, which holds the size. */
function jpegSize(b: Buffer): [number, number] | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (frame) return [be16(b, i + 7), be16(b, i + 5)];
    i += 2 + be16(b, i + 2);
  }
  return null;
}

function webpSize(b: Buffer): [number, number] | null {
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8 " && b.length >= 30) return [le16(b, 26) & 0x3fff, le16(b, 28) & 0x3fff];
  if (chunk === "VP8L" && b.length >= 25) {
    return [1 + (((b[22] & 0x3f) << 8) | b[21]), 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6))];
  }
  if (chunk === "VP8X" && b.length >= 30) return [1 + le24(b, 24), 1 + le24(b, 27)];
  return null;
}

/** The image type from the file's first bytes, never from its name. */
function kindOf(b: Buffer): Kind | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) {
    return { mime: "image/png", ext: "png", size: (x) => [x.readUInt32BE(16), x.readUInt32BE(20)] };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg", size: jpegSize };
  if (b.length >= 10 && /^GIF8[79]a$/.test(b.toString("ascii", 0, 6))) {
    return { mime: "image/gif", ext: "gif", size: (x) => [le16(x, 6), le16(x, 8)] };
  }
  if (b.length >= 16 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    return { mime: "image/webp", ext: "webp", size: webpSize };
  }
  return null;
}

/**
 * Turns what an agent passes into a path on this computer: quotes and file:// URLs are fine, ~ is the home
 * folder, and on Windows the Git Bash (/c/...), WSL (/mnt/c/...) and /tmp spellings map to Windows paths.
 * Relative paths are read from `base`, the folder the agent works in.
 */
export function resolveImagePath(input: string, base: string | null): string {
  let p = input.trim().replace(/^["']|["']$/g, "");
  if (/^file:\/\//i.test(p)) {
    try { p = fileURLToPath(p); } catch { /* Not a valid file URL; read it as a path. */ }
  }
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) p = path.join(os.homedir(), p.slice(1));
  if (process.platform === "win32") {
    const drive = /^\/(?:mnt\/)?([a-zA-Z])(\/.*)?$/.exec(p);
    if (drive) p = `${drive[1].toUpperCase()}:${drive[2] ?? "/"}`;
    else if (p === "/tmp" || p.startsWith("/tmp/")) p = path.join(os.tmpdir(), p.slice(4));
  }
  return path.resolve(base ?? process.cwd(), p);
}

/** Checks that `source` is a PNG, JPEG, GIF or WebP image and keeps a copy of it. Throws ImageError with a fixable message. */
export function storeImage(input: string, base: string | null): StoredImage {
  if (!input.trim()) throw new ImageError("The image path is empty.");
  const source = resolveImagePath(input, base);
  const shown = source === path.normalize(input.trim()) ? source : `${input.trim()} (read as ${source})`;
  let stat: fs.Stats;
  try {
    // turbopackIgnore: a path chosen at run time would make the build trace (and ship) the whole project.
    stat = fs.statSync(/* turbopackIgnore: true */ source);
  } catch {
    throw new ImageError(`PacedMind can't find ${shown}. Save the image to a file and pass its absolute path.`);
  }
  if (!stat.isFile()) throw new ImageError(`${shown} is a folder, not an image file.`);
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new ImageError(`${path.basename(source)} is ${(stat.size / 1048576).toFixed(1)} MB; an image can be up to ${MAX_IMAGE_BYTES / 1048576} MB. Save a smaller one, for example only the window instead of the whole screen.`);
  }
  const data = fs.readFileSync(/* turbopackIgnore: true */ source);
  const kind = kindOf(data);
  if (!kind) throw new ImageError(`${path.basename(source)} isn't a PNG, JPEG, GIF or WebP image.`);
  let size: [number, number] | null = null;
  try { size = kind.size(data); } catch { /* A size PacedMind can't read doesn't make the image unusable. */ }
  const id = crypto.randomBytes(8).toString("hex");
  const file = `${id}.${kind.ext}`;
  fs.mkdirSync(attachmentsDir(), { recursive: true });
  fs.writeFileSync(path.join(/* turbopackIgnore: true */ attachmentsDir(), file), data);
  const ok = size && size[0] > 0 && size[1] > 0;
  return { id, file, mime: kind.mime, bytes: data.length, width: ok ? size![0] : null, height: ok ? size![1] : null };
}

/** The stored copy of an attachment. `file` always comes from the database, never from a request. */
export function attachmentPath(file: string): string {
  return path.join(attachmentsDir(), path.basename(file));
}

/** Removes stored copies, e.g. after their task was deleted. Files that are already gone are fine. */
export function removeImageFiles(files: string[]) {
  for (const f of files) fs.rmSync(attachmentPath(f), { force: true });
}
