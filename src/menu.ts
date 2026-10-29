// Context menu entries: "Fetch arXiv LaTeX source" for selected items, and
// a bulk version for the selected collection, saved search or library.

import { fetchForItems, fetchInBulk, isBulkRunning, stopBulk } from "./runner";

const ITEM_MENU_ID = "texfetch-itemmenu";
const COLLECTION_MENU_ID = "texfetch-collectionmenu";

const cleanups = new WeakMap<Window, (() => void)[]>();

function addMenuItem(
  win: _ZoteroTypes.MainWindow,
  popupID: string,
  id: string,
  onShowing: (menuitem: XUL.MenuItem) => void,
  onCommand: () => void,
) {
  const doc = win.document;
  const popup = doc.getElementById(popupID);
  if (!popup || doc.getElementById(id)) return;

  const menuitem = doc.createXULElement("menuitem") as XUL.MenuItem;
  menuitem.id = id;
  menuitem.addEventListener("command", onCommand);
  popup.appendChild(menuitem);

  const showing = () => onShowing(menuitem);
  popup.addEventListener("popupshowing", showing);
  const list = cleanups.get(win) ?? [];
  list.push(() => {
    popup.removeEventListener("popupshowing", showing);
    menuitem.remove();
  });
  cleanups.set(win, list);
}

function rowKind(row: any): string | null {
  if (!row || row.isFeed() || row.isFeeds?.()) return null;
  if (row.isLibrary(true)) return "library";
  if (row.isCollection()) return "collection";
  if (row.isSearch()) return "saved search";
  return null;
}

export function addMenus(win: _ZoteroTypes.MainWindow) {
  const pane = win.ZoteroPane;

  addMenuItem(
    win,
    "zotero-itemmenu",
    ITEM_MENU_ID,
    (menuitem) => {
      menuitem.setAttribute("label", "Fetch arXiv LaTeX source");
      menuitem.hidden = !pane.getSelectedItems().some((i) => i.isRegularItem());
    },
    () => {
      const items = pane.getSelectedItems().filter((i) => i.isRegularItem());
      void fetchForItems(items);
    },
  );

  addMenuItem(
    win,
    "zotero-collectionmenu",
    COLLECTION_MENU_ID,
    (menuitem) => {
      const kind = rowKind(pane.getCollectionTreeRow());
      menuitem.hidden = !kind && !isBulkRunning();
      menuitem.setAttribute(
        "label",
        isBulkRunning()
          ? "Stop fetching arXiv LaTeX source"
          : `Fetch arXiv LaTeX source for this ${kind}`,
      );
    },
    async () => {
      if (isBulkRunning()) {
        stopBulk();
        return;
      }
      const row = pane.getCollectionTreeRow() as any;
      if (!row) return;
      const items = ((await row.getItems()) as Zotero.Item[]).filter(
        (item) => item.isRegularItem() && !item.deleted,
      );
      void fetchInBulk(items, row.getName());
    },
  );
}

export function removeMenus(win: Window) {
  for (const cleanup of cleanups.get(win) ?? []) cleanup();
  cleanups.delete(win);
}
