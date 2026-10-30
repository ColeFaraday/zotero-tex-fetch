import { config } from "../package.json";
import { fetchSourceForItem, resolveArxivIds } from "./attach";
import { registerAutoFetch, unregisterAutoFetch } from "./auto";
import { addMenus, removeMenus } from "./menu";
import { fetchForItems, fetchInBulk } from "./runner";

// Set by bootstrap.js on the script's scope.
declare const rootURI: string;

const hooks = {
  async onStartup() {
    await Promise.all([
      Zotero.initializationPromise,
      Zotero.unlockPromise,
      Zotero.uiReadyPromise,
    ]);
    for (const win of Zotero.getMainWindows()) addMenus(win);
    registerAutoFetch();
    Zotero.PreferencePanes.register({
      pluginID: config.addonID,
      src: `${rootURI}content/preferences.xhtml`,
      label: config.addonName,
    });
    addon.data.initialized = true;
  },

  onMainWindowLoad(win: _ZoteroTypes.MainWindow) {
    addMenus(win);
  },

  onMainWindowUnload(win: Window) {
    removeMenus(win);
  },

  onShutdown() {
    unregisterAutoFetch();
    for (const win of Zotero.getMainWindows()) removeMenus(win);
    delete (Zotero as any)[config.addonInstance];
  },
};

const addon = {
  data: { initialized: false },
  hooks,
  api: { fetchSourceForItem, fetchForItems, fetchInBulk, resolveArxivIds },
};

(Zotero as any)[config.addonInstance] ??= addon;
