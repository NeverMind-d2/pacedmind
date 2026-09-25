/**
 * Structured data in the static HTML, where crawlers read it. A server component on purpose: rendered
 * on the client, it would be missing from the first response. "<" is escaped so no value can close the
 * script element early.
 */
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
