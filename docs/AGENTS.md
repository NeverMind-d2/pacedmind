# docs/ — PacedMind user documentation

The public end-user documentation (Fumadocs), served at **pacedmind.com/docs**. Read this before editing any `.mdx` or `meta.json` here. [README.md](README.md) covers the build, the published URLs and the deployment.

---

## 1. What this project is

- Fumadocs on Next.js 16, exported as static files (`output: 'export'`, `basePath: '/docs'`). Content is MDX under `content/docs/`, one folder per section (`views/`, `agents/`, `mcp/`, …).
- Audience: **PacedMind's users**, people who plan their work in the app and run Claude Code or Codex from it. They want to get things done in the app, not learn its internals.
- The source of truth for *behavior* is the **app's code** in the repository (`../src`, `../desktop`, `../skills`, `../scripts`). When the docs and the code disagree, the code wins: update the docs. Check every UI label, message and default against the code; don't invent them.

---

## 2. Content structure

```
content/docs/
├── meta.json            # section order
├── <section>/
│   ├── meta.json        # page order in the section
│   ├── index.mdx        # section landing page
│   └── <page>.mdx
```

- A new section is a new folder with `index.mdx` and `meta.json`, registered in the root `meta.json`. A section that is a single page has `"pages": []`.
- A new page is a new `.mdx` file, registered in its section's `meta.json`.
- Every page has `title` and `description` in its frontmatter. The description feeds search results, link previews, `llms.txt` and the section tiles, so make it a real sentence. Quote it when it contains a colon.
- Link between pages with root-relative paths without `/docs`: `[Timeline](/views/timeline#dependencies)`. Next adds the base path.
- Images: plain `<img src="/docs/screenshots/…" alt="…" width="1920" height="1200" loading="lazy" />`, with the `/docs` prefix. Markdown image syntax would need Next's image optimizer, which a static export doesn't have.
- The home page tiles are in `src/app/[lang]/(home)/page.tsx`: update them when adding a section.

---

## 3. The two build traps

1. **No bare `{...}` in MDX prose.** MDX evaluates it as JavaScript and the build fails. Wrap it in a code span (`` `{id}` ``) or escape it (`\{ \}`). The same goes for placeholders like `<task key>`: a bare `<word>` is read as a JSX tag, so keep placeholders in code spans.
2. **Never list `"index"` in a `meta.json` `pages` array.** The landing page is implicit. Listing it makes Fumadocs treat it as a child page: the section header in the sidebar stops linking to it.

A third one, specific to tables: a `|` inside a code span in a table cell must be written `\|`.

Validate before declaring done:

```bash
grep -rn "{" content/docs --include=*.mdx | grep -v '`[^`]*{'   # bare braces: review each
grep -rn '"index"' content/docs --include=*.json                 # must be empty
npm run build                                                    # catches both
```

---

## 4. Voice and tone

- **Impersonal, factual, instructional.** Describe what the app does and how to use it. No marketing, no hype, no exclamation marks.
- **Plain, direct, present tense.** Prefer the product or the element as the subject (*"PacedMind opens a terminal…"*, *"**Request changes** sends the work back…"*), and the imperative for steps (*"Select **Start with Claude Code**."*).
- **UI labels in bold**, exactly as the app writes them. App messages and placeholder texts in italics, exactly as the app writes them. Keys as `<kbd>`.
- Tables for options and comparisons, numbered lists for steps, short paragraphs.
- Use *select* for buttons and menu items, *click* for direct manipulation (a row, a chip, a timeline bar), *drag* for drag and drop.

---

## 5. What the docs don't contain

- **Prices.** The website (`../site`) owns pricing; link to `https://pacedmind.com/#pricing` instead.
- **Vendor names** behind the product (hosting, databases, services). Claude Code, Codex, Windows Terminal and the MCP standard are part of the product and may be named.
- **Roadmap dates**, and features that aren't in the code.
- **Internal architecture** beyond what users need: file locations and the local server's address are in, implementation details are out.
- **Personal data**: screenshots come from the development server's sample data, with the folder paths replaced.

---

## 6. When the app changes

- A new or renamed **MCP tool**: update `mcp/tools/*.mdx`, the tool table in `mcp/index.mdx` and `mcp/tools/index.mdx`, and the list of tools allowed without asking in `agents/start-and-manage.mdx` when `AGENT_ALLOWED_TOOLS` changes.
- A new **view** or a changed sidebar: `views/`, `getting-started/first-launch.mdx`, `views/index.mdx`, and the screenshots.
- New **keyboard shortcuts**: `keyboard-shortcuts/index.mdx`.
- **Settings**: `settings/index.mdx`.
- Anything in the **desktop app** (tray, notifications, install): `desktop-app/index.mdx`, `getting-started/`.
- Accounts and Cloud: the plans, the trial, subscribing and what happens when Cloud ends (`accounts-and-cloud/`). Signing in, computers and moving data into an account still need their own pages.

---

## 7. Languages

English only, set up for more (`defineI18n` with `hideLocale: 'default-locale'`). To add a language, follow README.md. A translated page lives next to its original as `<page>.<lang>.mdx`, with the same headings in the same order.

---

## 8. Don't

- Don't use bare curly braces or bare `<placeholders>` in MDX prose.
- Don't list `"index"` in `meta.json` `pages`.
- Don't invent UI labels or behavior: read the app's code.
- Don't put prices, vendor names or roadmap dates in the pages.
- Don't `git commit` without explicit instruction.

---

## 9. Tooling

- Install with `npm ci` once `package-lock.json` is committed, so `node_modules` matches it.
- `npm run build` must pass, and every internal link must resolve, before declaring done.
- ESLint stays on 9.x: `eslint-config-next` 16 bundles a plugin that crashes on ESLint 10.
