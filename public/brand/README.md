# PacedMind

- `pacedmind-wordmark.png` is the active wordmark: the user's preferred geometric lettering
  with its gradual change in weight and the small notches in m and n closed.
- `pacedmind-emblem.svg` is the connected **pd** monogram. The first p and last d share
  one circular bowl, with a descending stem on the left and an ascending stem on the right.
  The solid white stems touch the top and bottom of the pure-black rounded tile.
  Use it for square placements instead of shrinking the wordmark.
- `pacedmind-emblem.png` is its 512px export. Windows icons and the favicon are generated from
  the same geometry by `npm run icons`; small sizes have a slightly heavier stroke for legibility.
- `pacedmind-approved.png` preserves the earlier approved gradient concept unchanged as an archive.

The crop and letter boundaries live in `src/lib/brand-geometry.json`. The React component
uses the actual artwork as an SVG luminance mask so the animation preserves the exact letter
shapes and spacing. The emblem is vector geometry; run `npm run icons` to regenerate it.

The app header displays only the wordmark at 112px wide (about 18px tall), after the back/forward
controls. The standalone emblem is reserved for app/tray/favicon icons. Navigation buttons reflect the current page history.
On Windows it replaces the native title text, with native window controls on the right and a draggable background. The sidebar starts
with search. On initial app load, the p and final d share
a bowl for 320ms, then unfold into the full name over 1.1 seconds. The intermediate letters
appear in sequence. The header persists across navigation, so the animation does not replay
between views. `prefers-reduced-motion: reduce` displays the full wordmark immediately.

The header reserves an additional pixel below the native controls overlay for its full-width
separator, so the minimize/maximize/close buttons cannot cover the line.

Both PNG concepts were created with the built-in image generation tool on 2026-09-24.
Final edit prompt: close only the two small triangular white notches in the upper-left curves
of m and n, preserving the lowercase pacedmind text, geometric letter shapes, gradual
left-to-right change in stroke weight, spacing, alignment, black ink and white background.
