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

// Keeps each request's query string a reasonable length.
const BATCH_SIZE = 25;

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

export async function lookupOnInspire(
  queries: InspireQuery[],
): Promise<(InspireEprint | null)[]> {
  const results: (InspireEprint | null)[] = [];
  for (let i = 0; i < queries.length; i += BATCH_SIZE) {
    const batch = queries.slice(i, i + BATCH_SIZE);
    const query = buildInspireQuery(batch);
    if (!query) {
      results.push(...batch.map(() => null));
      continue;
    }
    const url =
      "https://inspirehep.net/api/literature?size=100&fields=arxiv_eprints,dois,texkeys&q=" +
      encodeURIComponent(query);
    try {
      const xhr = await Zotero.HTTP.request("GET", url, {
        responseType: "json",
        headers: { Accept: "application/json" },
      });
      results.push(...matchInspireHits(xhr.response, batch));
    } catch (e) {
      Zotero.logError(e as Error);
      results.push(...batch.map(() => null));
    }
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
