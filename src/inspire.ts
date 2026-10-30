// Looks up arXiv IDs on INSPIRE-HEP by DOI or INSPIRE texkey, for items
// imported from journals that carry no arXiv metadata of their own.

import { normalizeArxivId } from "./arxiv-id";

export interface InspireQuery {
  doi: string;
  texkey: string;
}

export interface InspireEprint {
  arxivId: string;
  category: string | null;
}

// INSPIRE answers 502/400 once the URL passes roughly 2000 characters, so
// batches are sized by the encoded query's length, not a fixed count.
const MAX_ENCODED_QUERY_LENGTH = 1600;

// Zotero.HTTP retries 5xx responses for up to an hour by default; a failed
// batch is split instead.
const HTTP_RETRY = { errorDelayIntervals: [2000, 5000], errorDelayMax: 7000 };

export function buildInspireQuery(queries: InspireQuery[]): string | null {
  const terms: string[] = [];
  for (const { doi, texkey } of queries) {
    if (doi) terms.push(`doi:"${doi.replace(/"/g, "")}"`);
    if (texkey) terms.push(`texkeys:"${texkey.replace(/"/g, "")}"`);
  }
  return terms.length ? terms.join(" or ") : null;
}

// Matches hits back to the queries by DOI or texkey, since one request
// answers a whole batch.
export function matchInspireHits(
  json: any,
  queries: InspireQuery[],
): (InspireEprint | null)[] {
  const byDoi = new Map<string, InspireEprint>();
  const byTexkey = new Map<string, InspireEprint>();
  for (const hit of json?.hits?.hits ?? []) {
    const metadata = hit.metadata ?? {};
    const eprint = metadata.arxiv_eprints?.[0];
    const arxivId = eprint?.value ? normalizeArxivId(eprint.value) : null;
    if (!arxivId) continue;
    const found = { arxivId, category: eprint.categories?.[0] ?? null };
    for (const doi of metadata.dois ?? []) {
      if (doi.value) byDoi.set(doi.value.toLowerCase(), found);
    }
    for (const texkey of metadata.texkeys ?? []) byTexkey.set(texkey, found);
  }
  return queries.map(
    ({ doi, texkey }) =>
      (doi && byDoi.get(doi.toLowerCase())) || (texkey && byTexkey.get(texkey)) || null,
  );
}

export function batchQueries(queries: InspireQuery[]): InspireQuery[][] {
  const batches: InspireQuery[][] = [];
  let current: InspireQuery[] = [];
  for (const query of queries) {
    const next = [...current, query];
    const length = encodeURIComponent(buildInspireQuery(next) ?? "").length;
    if (current.length && length > MAX_ENCODED_QUERY_LENGTH) {
      batches.push(current);
      current = [query];
    } else {
      current = next;
    }
  }
  if (current.length) batches.push(current);
  return batches;
}

async function lookupBatch(batch: InspireQuery[]): Promise<(InspireEprint | null)[]> {
  const query = buildInspireQuery(batch);
  if (!query) return batch.map(() => null);
  const url =
    "https://inspirehep.net/api/literature?size=100&fields=arxiv_eprints,dois,texkeys&q=" +
    encodeURIComponent(query);
  try {
    const xhr = await Zotero.HTTP.request("GET", url, {
      responseType: "json",
      headers: { Accept: "application/json" },
      ...HTTP_RETRY,
    } as any);
    return matchInspireHits(xhr.response, batch);
  } catch (e) {
    if (batch.length === 1) {
      Zotero.logError(e as Error);
      return [null];
    }
    const half = Math.ceil(batch.length / 2);
    return [
      ...(await lookupBatch(batch.slice(0, half))),
      ...(await lookupBatch(batch.slice(half))),
    ];
  }
}

export async function lookupOnInspire(
  queries: InspireQuery[],
): Promise<(InspireEprint | null)[]> {
  const results: (InspireEprint | null)[] = [];
  for (const batch of batchQueries(queries)) {
    results.push(...(await lookupBatch(batch)));
  }
  return results;
}

// Same line format the zotero-inspire plugin writes, so either can read it.
export function extraWithArxiv(extra: string, eprint: InspireEprint): string {
  const line = /^\d/.test(eprint.arxivId) && eprint.category
    ? `arXiv:${eprint.arxivId} [${eprint.category}]`
    : `arXiv:${eprint.arxivId}`;
  const trimmed = extra.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n${line}` : line;
}
