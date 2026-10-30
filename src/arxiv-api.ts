// Shared arXiv request budget, and latest-version lookups through the arXiv
// API (many IDs per request, so a bulk run doesn't download unchanged papers).

// arXiv asks automated clients for at most one request every 3 seconds,
// across both arxiv.org and export.arxiv.org.
const MIN_REQUEST_INTERVAL_MS = 3000;
let lastRequestAt = 0;

export async function arxivThrottle() {
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await Zotero.Promise.delay(wait);
  lastRequestAt = Date.now();
}

// Zotero.HTTP otherwise keeps retrying 5xx responses for up to an hour.
export const ARXIV_HTTP_RETRY = { errorDelayMax: 60_000 };

const BATCH_SIZE = 100;

export function parseVersions(atom: string): Map<string, number> {
  const versions = new Map<string, number>();
  const re = /<entry>[\s\S]*?<id>\s*https?:\/\/arxiv\.org\/abs\/(\S+?)v(\d+)\s*<\/id>/g;
  for (const m of atom.matchAll(re)) versions.set(m[1], Number(m[2]));
  return versions;
}

// IDs missing from the result (unknown to the API, or a failed batch) are
// simply absent; callers fall back to downloading.
export async function latestVersions(arxivIds: string[]): Promise<Map<string, number>> {
  const versions = new Map<string, number>();
  const unique = [...new Set(arxivIds)];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const url =
      "https://export.arxiv.org/api/query?max_results=" +
      batch.length +
      "&id_list=" +
      batch.join(",");
    try {
      await arxivThrottle();
      const xhr = await Zotero.HTTP.request("GET", url, {
        responseType: "text",
        ...ARXIV_HTTP_RETRY,
      } as any);
      for (const [id, version] of parseVersions(xhr.responseText ?? "")) {
        versions.set(id, version);
      }
    } catch (e) {
      Zotero.logError(e as Error);
    }
  }
  return versions;
}
