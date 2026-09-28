/** Only local HTTP callbacks can finish in a temporary window; hosted clients keep their normal redirect. */
export function isLoopbackCallback(uri: string): boolean {
  try {
    const url = new URL(uri);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}
