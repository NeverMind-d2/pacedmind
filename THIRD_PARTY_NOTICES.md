# Third-party notices

PacedMind is licensed under the GNU Affero General Public License, version 3 ([LICENSE](LICENSE)). It includes material from the projects below, which stays under their licenses. These are the notices those licenses ask for.

## Feather and Lucide

Many of the interface icons in `src/components/icons.tsx`, and the website's in `site/components/screens/parts.tsx`, are adapted from [Feather](https://feathericons.com) and [Lucide](https://lucide.dev): their shapes, redrawn as single paths. The icons an area can show, in `src/components/area-icon-paths.ts`, are Lucide's, made the same way by `scripts/area-icons.mjs`.

Feather:

```
The MIT License (MIT)

Copyright (c) 2013-2023 Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Lucide (its icons derived from Feather are under Feather's license above):

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## LobeHub Icons

The Codex mark in `src/components/icons.tsx` comes from [LobeHub Icons](https://github.com/lobehub/lobe-icons).

```
MIT License

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Simple Icons

The Claude mark in `src/components/icons.tsx`, and the GitHub mark in `site/components/github-mark.tsx`, come from [Simple Icons](https://simpleicons.org), which dedicates its icons to the public domain (CC0 1.0).

The brand marks Settings → Computers shows next to MCP servers and connectors, in `src/components/tool-icon-paths.ts` (made by `scripts/tool-icons.mjs`), come from Simple Icons too.

Claude is a trademark of Anthropic, and Codex of OpenAI. PacedMind uses their names and marks only to show which agent runs a session. GitHub is a trademark of GitHub, Inc.; the website uses its mark only on links to PacedMind's repository. The marks next to MCP servers and connectors are trademarks of their owners, shown only to name the service a server or connector reaches.

## Google's "G"

The sign-in page's **Continue with Google** button shows Google's "G" logo (`GoogleMark` in `src/app/login/forms.tsx`). It is a trademark of Google LLC, used in a sign-in button as Google's sign-in branding guidelines allow (https://developers.google.com/identity/branding-guidelines); the AGPL doesn't cover it.

## Fonts

The app, the website and the documentation use Geist and Geist Mono (by Vercel) and Jost (by Owen Earl), which `next/font/google` downloads from Google Fonts when they're built. The fonts are licensed under the [SIL Open Font License 1.1](https://openfontlicense.org).

## npm packages

Everything else PacedMind uses comes from npm, as listed in `package.json` and `package-lock.json` in the repository's root, `site/` and `docs/`. Each package keeps its own license, which it ships with. They're MIT, Apache-2.0, ISC, BSD or similar permissive licenses, apart from the optional prebuilt libvips binaries of `sharp` (LGPL-3.0-or-later) and `lightningcss` (MPL-2.0, used only when building).
