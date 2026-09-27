-- An area can show a picture of its own, such as a company logo, instead of an icon or its dot. The browser draws
-- the image picked into a small PNG (src/lib/area-picture.ts: 64 pixels at most), and the area keeps it here in
-- base64. Held to a PNG's first bytes, base64's letters and a size, so no markup or other text can pass for one.
alter table public.areas
  add column picture text check (octet_length(picture) <= 32768 and picture ~ '^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$');
