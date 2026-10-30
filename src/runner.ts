// Runs fetches: per-item progress for small selections, a single summary
// line for bulk runs over a collection or library.

import {
  attachedVersion,
  fetchSourceForItem,
  findSourceAttachment,
  Outcome,
  resolveArxivIds,
} from "./attach";
import { latestVersions } from "./arxiv-api";

function describe(outcome: Outcome): string {
  switch (outcome.status) {
    case "no-arxiv-id":
      return "no arXiv ID found (not on INSPIRE either)";
    case "pdf-only":
      return "PDF-only submission, no LaTeX source";
    case "added":
      return `added v${outcome.version ?? "?"}`;
    case "updated":
      return `updated to v${outcome.version ?? "?"}`;
    case "up-to-date":
      return `already up to date (v${outcome.version ?? "?"})`;
  }
}

// Runs go one at a time, so a manual run and an automatic one can't both
// create an attachment for the same item.
let queue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

export function fetchForItems(
  items: Zotero.Item[],
  options: { quiet?: boolean } = {},
): Promise<void> {
  return enqueue(() => runFetch(items, options.quiet ?? false));
}

// Quiet runs (automatic ones) only open a progress window once there's
// something to report, and say nothing about items without an arXiv ID.
async function runFetch(items: Zotero.Item[], quiet: boolean) {
  if (!items.length) return;

  let progress: Zotero.ProgressWindow | null = null;
  const openProgress = () => {
    if (!progress) {
      progress = new Zotero.ProgressWindow({ closeOnClick: true });
      progress.changeHeadline("arXiv LaTeX source");
      progress.show();
    }
    return progress;
  };

  for (const item of items) {
    const name = item.getDisplayTitle();
    const line = quiet ? null : new (openProgress().ItemProgress)(item.itemType, name);
    line?.setProgress(50);
    try {
      const outcome = await fetchSourceForItem(item);
      if (quiet && outcome.status === "no-arxiv-id") continue;
      const done = line ?? new (openProgress().ItemProgress)(item.itemType, name);
      done.setText(`${name}: ${describe(outcome)}`);
      if (outcome.status === "no-arxiv-id" || outcome.status === "pdf-only") {
        done.setError();
      } else {
        done.setProgress(100);
      }
    } catch (e) {
      Zotero.logError(e as Error);
      const failed = line ?? new (openProgress().ItemProgress)(item.itemType, name);
      failed.setText(`${name}: failed (${(e as Error).message})`);
      failed.setError();
    }
  }
  (progress as Zotero.ProgressWindow | null)?.startCloseTimer(8000);
}

export type Counts = Record<Outcome["status"] | "failed", number>;

let bulkRunning = false;
let stopRequested = false;

export const isBulkRunning = () => bulkRunning;

export function stopBulk() {
  stopRequested = true;
}

export function fetchInBulk(items: Zotero.Item[], name: string): Promise<Counts> {
  bulkRunning = true;
  stopRequested = false;
  let counts: Counts | undefined;
  return enqueue(async () => {
    counts = await runBulk(items, name);
  })
    .then(() => counts!)
    .finally(() => {
      bulkRunning = false;
    });
}

function summarize(done: number, total: number, counts: Counts) {
  const parts = [
    [counts.added, "added"],
    [counts.updated, "updated"],
    [counts["up-to-date"], "up to date"],
    [counts["no-arxiv-id"], "no arXiv ID"],
    [counts["pdf-only"], "PDF-only"],
    [counts.failed, "failed"],
  ]
    .filter(([n]) => n)
    .map(([n, label]) => `${n} ${label}`);
  return [`${done}/${total}`, ...parts].join(" · ");
}

// Large runs go in chunks: look up the chunk's arXiv IDs and versions in
// batches, then download what's needed. Progress moves from the start, Stop
// works at any point, and items already up to date cost no download.
const CHUNK_SIZE = 100;

async function runBulk(items: Zotero.Item[], name: string): Promise<Counts> {
  const counts: Counts = {
    added: 0,
    updated: 0,
    "up-to-date": 0,
    "no-arxiv-id": 0,
    "pdf-only": 0,
    failed: 0,
  };

  const progress = new Zotero.ProgressWindow({ closeOnClick: false });
  progress.changeHeadline(`arXiv LaTeX source: ${name}`);
  const line = new progress.ItemProgress("document", `0/${items.length}`);
  progress.show();

  let done = 0;
  const report = (activity?: string) => {
    line.setProgress((done / items.length) * 100);
    const summary = summarize(done, items.length, counts);
    line.setText(activity ? `${summary} · ${activity}` : summary);
  };

  for (let start = 0; start < items.length && !stopRequested; start += CHUNK_SIZE) {
    const chunk = items.slice(start, start + CHUNK_SIZE);
    try {
      report("looking up arXiv IDs…");
      const arxivIds = await resolveArxivIds(chunk);
      if (stopRequested) break;

      const toCheck = chunk.filter((item) => {
        const existing = arxivIds.has(item.id) && findSourceAttachment(item);
        return existing && attachedVersion(existing) !== null;
      });
      if (toCheck.length) report("checking arXiv versions…");
      const versions = await latestVersions(toCheck.map((item) => arxivIds.get(item.id)!));

      for (const item of chunk) {
        if (stopRequested) break;
        const arxivId = arxivIds.get(item.id) ?? null;
        try {
          const outcome = await fetchSourceForItem(item, {
            arxivId,
            latestVersion: arxivId ? (versions.get(arxivId) ?? null) : null,
          });
          counts[outcome.status]++;
        } catch (e) {
          Zotero.logError(e as Error);
          counts.failed++;
        }
        done++;
        report();
      }
    } catch (e) {
      // A lookup failure loses this chunk, not the run.
      Zotero.logError(e as Error);
      const remaining = start + chunk.length - done;
      counts.failed += remaining;
      done += remaining;
      report();
    }
  }

  const status = stopRequested ? "Stopped" : "Done";
  line.setText(`${status}: ${summarize(done, items.length, counts)}`);
  progress.startCloseTimer(20000);
  return counts;
}
