import { defineI18n } from 'fumadocs-core/i18n';

// English only for now. To add a language (e.g. Polish): add it here, add `<page>.pl.mdx` and
// `meta.pl.json` siblings, add it to `otherLanguages` in next.config.mjs, and give it UI
// translations in src/app/[lang]/layout.tsx. The build keeps its pages under /docs/<lang>/.
export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en'],
  hideLocale: 'default-locale',
});
