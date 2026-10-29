// Looks up arXiv IDs on INSPIRE-HEP by DOI or INSPIRE texkey, for items
// imported from journals that carry no arXiv metadata of their own.

import { normalizeArxivId } from "./arxiv-id";

export interface InspireEprint {
  arxivId: string;
  category: string | null;
}

export function buildInspireQuery(doi: string, texkey: string): string | null {
  const terms: string[] = [];
  if (doi) terms.push(`doi:"${doi.replace(/"/g, "")}"`);
  if (texkey) terms.push(`texkeys:"${texkey.replace(/"/g, "")}"`);
  return terms.length ? terms.join(" or ") : null;
}

export function parseInspireResponse(json: any): InspireEprint | null {
  for (const hit of json?.hits?.hits ?? []) {
    const eprint = hit.metadata?.arxiv_eprints?.[0];
    const arxivId = eprint?.value ? normalizeArxivId(eprint.value) : null;
    if (arxivId) return { arxivId, category: eprint.categories?.[0] ?? null };
  }
  return null;
}

export async function lookupOnInspire(
  doi: string,
  texkey: string,
): Promise<InspireEprint | null> {
  const query = buildInspireQuery(doi, texkey);
  if (!query) return null;
  const url =
    "https://inspirehep.net/api/literature?size=1&fields=arxiv_eprints&q=" +
    encodeURIComponent(query);
  const xhr = await Zotero.HTTP.request("GET", url, {
    responseType: "json",
    headers: { Accept: "application/json" },
  });
  return parseInspireResponse(xhr.response);
}

// Same line format the zotero-inspire plugin writes, so either can read it.
export function extraWithArxiv(extra: string, eprint: InspireEprint): string {
  const line = /^\d/.test(eprint.arxivId) && eprint.category
    ? `arXiv:${eprint.arxivId} [${eprint.category}]`
    : `arXiv:${eprint.arxivId}`;
  const trimmed = extra.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n${line}` : line;
}
