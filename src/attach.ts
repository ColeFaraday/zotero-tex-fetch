// Fetches an item's arXiv source and stores it as a flattened .tex child
// attachment, overwriting the existing one in place when a new version is out.

import { decodeEprint, versionFromFilename } from "./archive";
import { findArxivId, IdSources } from "./arxiv-id";
import { flattenSource } from "./flatten";
import { extraWithArxiv, lookupOnInspire } from "./inspire";

export const TAG = "_arxiv-tex";
const TITLE_RE = /^arXiv LaTeX source(?: \(v(\d+)\))?$/;

// arXiv asks automated clients for at most one request every 3 seconds.
const MIN_REQUEST_INTERVAL_MS = 3000;
let lastRequestAt = 0;

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
// Extra, so later runs and other tools don't need the lookup.
async function resolveArxivId(item: Zotero.Item): Promise<string | null> {
  const local = findArxivId(idSources(item));
  if (local) return local;

  const eprint = await lookupOnInspire(field(item, "DOI"), field(item, "citationKey"));
  if (!eprint) return null;
  item.setField("extra", extraWithArxiv(field(item, "extra"), eprint));
  await item.saveTx();
  return eprint.arxivId;
}

async function throttle() {
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await Zotero.Promise.delay(wait);
  lastRequestAt = Date.now();
}

async function download(arxivId: string) {
  await throttle();
  const xhr = await Zotero.HTTP.request("GET", `https://arxiv.org/src/${arxivId}`, {
    responseType: "arraybuffer",
  });
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

function attachedVersion(attachment: Zotero.Item): number | null {
  const m = TITLE_RE.exec(attachment.getField("title") as string);
  return m?.[1] ? Number(m[1]) : null;
}

export async function fetchSourceForItem(item: Zotero.Item): Promise<Outcome> {
  const arxivId = await resolveArxivId(item);
  if (!arxivId) return { status: "no-arxiv-id" };

  const { data, version } = await download(arxivId);
  const existing = findSourceAttachment(item);
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
