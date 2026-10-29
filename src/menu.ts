// Item context menu entry: "Fetch arXiv LaTeX source".

import { fetchSourceForItem, Outcome } from "./attach";

const MENU_ID = "texfetch-itemmenu";
const showingHandlers = new WeakMap<Window, () => void>();

export function addItemMenu(win: _ZoteroTypes.MainWindow) {
  const doc = win.document;
  const popup = doc.getElementById("zotero-itemmenu");
  if (!popup || doc.getElementById(MENU_ID)) return;

  const menuitem = doc.createXULElement("menuitem");
  menuitem.id = MENU_ID;
  menuitem.setAttribute("label", "Fetch arXiv LaTeX source");
  menuitem.addEventListener("command", () => {
    const items = win.ZoteroPane.getSelectedItems().filter((i) => i.isRegularItem());
    void fetchForItems(items);
  });
  popup.appendChild(menuitem);

  const onShowing = () => {
    const anyRegular = win.ZoteroPane.getSelectedItems().some((i) => i.isRegularItem());
    (menuitem as XUL.MenuItem).hidden = !anyRegular;
  };
  popup.addEventListener("popupshowing", onShowing);
  showingHandlers.set(win, onShowing);
}

export function removeItemMenu(win: Window) {
  const doc = win.document;
  doc.getElementById(MENU_ID)?.remove();
  const onShowing = showingHandlers.get(win);
  if (onShowing) {
    doc.getElementById("zotero-itemmenu")?.removeEventListener("popupshowing", onShowing);
    showingHandlers.delete(win);
  }
}

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

export async function fetchForItems(items: Zotero.Item[]) {
  if (!items.length) return;

  const progress = new Zotero.ProgressWindow({ closeOnClick: true });
  progress.changeHeadline("arXiv LaTeX source");
  progress.show();

  for (const item of items) {
    const name = item.getDisplayTitle();
    const line = new progress.ItemProgress(item.itemType, name);
    line.setProgress(50);
    try {
      const outcome = await fetchSourceForItem(item);
      line.setText(`${name}: ${describe(outcome)}`);
      if (outcome.status === "no-arxiv-id" || outcome.status === "pdf-only") {
        line.setError();
      } else {
        line.setProgress(100);
      }
    } catch (e) {
      Zotero.logError(e as Error);
      line.setText(`${name}: failed (${(e as Error).message})`);
      line.setError();
    }
  }
  progress.startCloseTimer(8000);
}
