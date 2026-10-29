import { config } from "../package.json";
import { fetchSourceForItem } from "./attach";
import { addItemMenu, fetchForItems, removeItemMenu } from "./menu";

const hooks = {
  async onStartup() {
    await Promise.all([
      Zotero.initializationPromise,
      Zotero.unlockPromise,
      Zotero.uiReadyPromise,
    ]);
    for (const win of Zotero.getMainWindows()) addItemMenu(win);
    addon.data.initialized = true;
  },

  onMainWindowLoad(win: _ZoteroTypes.MainWindow) {
    addItemMenu(win);
  },

  onMainWindowUnload(win: Window) {
    removeItemMenu(win);
  },

  onShutdown() {
    for (const win of Zotero.getMainWindows()) removeItemMenu(win);
    delete (Zotero as any)[config.addonInstance];
  },
};

const addon = {
  data: { initialized: false },
  hooks,
  api: { fetchSourceForItem, fetchForItems },
};

(Zotero as any)[config.addonInstance] ??= addon;
