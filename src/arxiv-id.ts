// arXiv identifier detection. Pure: no Zotero globals.

export interface IdSources {
  archiveID?: string;
  DOI?: string;
  extra?: string;
  url?: string;
}

// New-style (0704.0001 onwards) and old-style (hep-th/9901001) identifiers,
// with an optional version suffix that we drop: we always fetch the latest.
const ID_RE = /^((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}))(?:v\d+)?$/;

export function normalizeArxivId(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^arxiv:\s*/i, "")
    .replace(/\.pdf$/i, "")
    .replace(/\/$/, "");
  const match = ID_RE.exec(cleaned);
  return match ? match[1] : null;
}

export function findArxivId(sources: IdSources): string | null {
  const candidates: string[] = [];

  if (sources.archiveID) {
    const m = /^arxiv:\s*(\S+)/i.exec(sources.archiveID.trim());
    if (m) candidates.push(m[1]);
  }
  if (sources.DOI) {
    const m = /^10\.48550\/arxiv\.(\S+)$/i.exec(sources.DOI.trim());
    if (m) candidates.push(m[1]);
  }
  if (sources.extra) {
    for (const m of sources.extra.matchAll(/^arxiv:\s*(\S+)/gim)) {
      candidates.push(m[1]);
    }
  }
  if (sources.url) {
    const m = /arxiv\.org\/(?:abs|pdf|html|src|e-print)\/([^?#\s]+)/i.exec(
      sources.url,
    );
    if (m) candidates.push(m[1]);
  }

  for (const candidate of candidates) {
    const id = normalizeArxivId(candidate);
    if (id) return id;
  }
  return null;
}
