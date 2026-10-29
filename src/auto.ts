// Fetches the arXiv source for newly added items, when the autoFetch pref
// is on.

import { config } from "../package.json";
import { findSourceAttachment } from "./attach";
import { fetchForItems } from "./runner";

export const AUTO_FETCH_PREF = `${config.prefsPrefix}.autoFetch`;

// Let translators finish saving the item and its attachments before we read
// its fields.
const SETTLE_MS = 5000;

let observerID: string | null = null;
const pending = new Set<number>();
let scheduled = false;

export function registerAutoFetch() {
  observerID = Zotero.Notifier.registerObserver(
    {
      notify(event: string, type: string, ids: (number | string)[]) {
        if (event !== "add" || type !== "item") return;
        if (!Zotero.Prefs.get(AUTO_FETCH_PREF, true)) return;
        // Items arriving by sync were added on another device, which may have
        // fetched the source already; fetching here too would duplicate it.
        if (Zotero.Sync.Runner.syncInProgress) return;

        for (const id of ids) pending.add(Number(id));
        if (!scheduled) {
          scheduled = true;
          void Zotero.Promise.delay(SETTLE_MS).then(flush);
        }
      },
    },
    ["item"],
    config.addonRef,
  );
}

export function unregisterAutoFetch() {
  if (observerID) Zotero.Notifier.unregisterObserver(observerID);
  observerID = null;
}

async function flush() {
  scheduled = false;
  const ids = [...pending];
  pending.clear();

  const items = Zotero.Items.get(ids).filter(
    (item): item is Zotero.Item =>
      !!item &&
      item.isRegularItem() &&
      !item.deleted &&
      !(item as any).isFeedItem &&
      !findSourceAttachment(item),
  );
  await fetchForItems(items, { quiet: true });
}
