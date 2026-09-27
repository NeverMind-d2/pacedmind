import { SITE } from "@/lib/site";

/** A star count as GitHub gives it: a whole number, never negative. */
export const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

let asked: Promise<number | null> | undefined;

/**
 * The repository's star count as the page is built, or null when GitHub doesn't answer (offline, or past
 * its 60 requests an hour for one address). The page shows it from the first paint; in the browser,
 * StarCount then swaps in the count the server keeps current. Asked once per process, so `npm run dev`
 * doesn't ask again on every reload.
 */
export function starsAtBuild(): Promise<number | null> {
  asked ??= fetch(`https://api.github.com/repos/${SITE.repo}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "pacedmind.com" },
    signal: AbortSignal.timeout(5000),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (isCount(data?.stargazers_count) ? data.stargazers_count : null))
    .catch(() => null);
  return asked;
}
