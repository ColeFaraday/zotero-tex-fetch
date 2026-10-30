// Fetches an item's arXiv source and stores it as a flattened .tex child
// attachment, overwriting the existing one in place when a new version is out.

import { decodeEprint, versionFromFilename } from "./archive";
import { ARXIV_HTTP_RETRY, arxivThrottle, latestVersions } from "./arxiv-api";
import { findArxivId, IdSources } from "./arxiv-id";
import { flattenSource } from "./flatten";
import { extraWithArxiv, lookupOnInspire } from "./inspire";

export const TAG = "_arxiv-tex";
const TITLE_RE = /^arXiv LaTeX source(?: \(v(\d+)\))?$/;

export type Outcome =
  | { status: "no-arxiv-id" }
  | { status: "pdf-only"; arxivId: string }
  | {
      status: "added" | "updated" | "up-to-date";
      arxivId: string;
      version: number | null;
      attachment: Zotero.Item;
    };

function field(item: Zotero.Item, name: string): string {
  try {
    return String(item.getField(name as any) ?? "");
  } catch {
    return "";
  }
}

function idSources(item: Zotero.Item): IdSources {
  return {
    archiveID: field(item, "archiveID"),
    DOI: field(item, "DOI"),
    extra: field(item, "extra"),
    url: field(item, "url"),
  };
}

// Falls back to INSPIRE (by DOI or texkey) and records what it finds in
// Extra, so later runs and other tools don't need the lookup. Returns a map
// from item ID to arXiv ID; items with no arXiv ID are absent.
export async function resolveArxivIds(items: Zotero.Item[]): Promise<Map<number, string>> {
  const ids = new Map<number, string>();
  const unresolved: Zotero.Item[] = [];
  for (const item of items) {
    const local = findArxivId(idSources(item));
    if (local) ids.set(item.id, local);
    else if (field(item, "DOI") || field(item, "citationKey")) unresolved.push(item);
  }

  const eprints = await lookupOnInspire(
    unresolved.map((item) => ({
      doi: field(item, "DOI"),
      texkey: field(item, "citationKey"),
    })),
  );
  // One transaction for the whole chunk: saving items one by one is slow on
  // large libraries.
  const found = eprints.flatMap((eprint, i) => (eprint ? [{ item: unresolved[i], eprint }] : []));
  if (found.length) {
    await Zotero.DB.executeTransaction(async () => {
      for (const { item, eprint } of found) {
        item.setField("extra", extraWithArxiv(field(item, "extra"), eprint));
        await item.save();
      }
    });
  }
  for (const { item, eprint } of found) ids.set(item.id, eprint.arxivId);
  return ids;
}

async function download(arxivId: string) {
  await arxivThrottle();
  const xhr = await Zotero.HTTP.request("GET", `https://arxiv.org/src/${arxivId}`, {
    responseType: "arraybuffer",
    ...ARXIV_HTTP_RETRY,
  } as any);
  const disposition = xhr.getResponseHeader("Content-Disposition") ?? "";
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? "";
  return {
    data: new Uint8Array(xhr.response as ArrayBuffer),
    version: versionFromFilename(filename),
  };
}

export function findSourceAttachment(item: Zotero.Item): Zotero.Item | undefined {
  return item
    .getAttachments()
    .map((id) => Zotero.Items.get(id))
    .find((attachment): attachment is Zotero.Item => !!attachment && attachment.hasTag(TAG));
}

export function attachedVersion(attachment: Zotero.Item): number | null {
  const m = TITLE_RE.exec(attachment.getField("title") as string);
  return m?.[1] ? Number(m[1]) : null;
}

// `known` lets bulk runs pass in IDs and versions they looked up in batches;
// anything not given is looked up here.
export async function fetchSourceForItem(
  item: Zotero.Item,
  known: { arxivId?: string | null; latestVersion?: number | null } = {},
): Promise<Outcome> {
  const arxivId =
    known.arxivId !== undefined
      ? known.arxivId
      : ((await resolveArxivIds([item])).get(item.id) ?? null);
  if (!arxivId) return { status: "no-arxiv-id" };

  // Ask the API first so an unchanged paper isn't downloaded again.
  const existing = findSourceAttachment(item);
  if (existing) {
    const latest =
      known.latestVersion !== undefined
        ? known.latestVersion
        : ((await latestVersions([arxivId])).get(arxivId) ?? null);
    if (latest !== null && attachedVersion(existing) === latest) {
      return { status: "up-to-date", arxivId, version: latest, attachment: existing };
    }
  }

  const { data, version } = await download(arxivId);
  if (existing && version !== null && attachedVersion(existing) === version) {
    return { status: "up-to-date", arxivId, version, attachment: existing };
  }

  const eprint = await decodeEprint(data);
  if (eprint.kind === "pdf") return { status: "pdf-only", arxivId };

  const label = `arXiv:${arxivId}${version ? `v${version}` : ""}`;
  const { text } = flattenSource(eprint.files, { label });

  const filename = `arXiv-${arxivId.replace("/", "_")}${version ? `v${version}` : ""}.tex`;
  const title = version ? `arXiv LaTeX source (v${version})` : "arXiv LaTeX source";

  if (existing) {
    await overwrite(existing, text, filename, title);
    return { status: "updated", arxivId, version, attachment: existing };
  }
  const attachment = await create(item, text, filename, title);
  return { status: "added", arxivId, version, attachment };
}

async function create(
  item: Zotero.Item,
  text: string,
  filename: string,
  title: string,
): Promise<Zotero.Item> {
  const tmpDir = await Zotero.Attachments.createTemporaryStorageDirectory();
  try {
    const tmpFile = tmpDir.clone();
    tmpFile.append(filename);
    await Zotero.File.putContentsAsync(tmpFile.path, text);

    const attachment = await Zotero.Attachments.importFromFile({
      file: tmpFile.path,
      parentItemID: item.id,
      title,
      contentType: "text/plain",
      charset: "utf-8",
    } as any);
    attachment.addTag(TAG);
    await attachment.saveTx();
    return attachment;
  } finally {
    tmpDir.remove(true);
  }
}

// Rewrites the existing attachment's file so its key (and anything an agent
// stored that points at it) stays valid.
async function overwrite(
  attachment: Zotero.Item,
  text: string,
  filename: string,
  title: string,
) {
  const path = await attachment.getFilePathAsync();
  if (path) {
    await Zotero.File.putContentsAsync(path, text);
    await attachment.renameAttachmentFile(filename);
  } else {
    // Stored file not present locally (e.g. never downloaded by sync).
    const file = Zotero.Attachments.getStorageDirectory(attachment);
    await Zotero.File.createDirectoryIfMissingAsync(file.path);
    file.append(filename);
    await Zotero.File.putContentsAsync(file.path, text);
    attachment.attachmentFilename = filename;
  }
  attachment.setField("title", title);
  await attachment.saveTx();
  await Zotero.Fulltext.indexItems([attachment.id], { complete: true } as any);
}
