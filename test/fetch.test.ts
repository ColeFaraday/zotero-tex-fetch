/// <reference types="mocha" />
import { assert } from "chai";
import { config } from "../package.json";

// Runs inside Zotero (`npm test`) against the live arXiv servers.

const api = () => (Zotero as any)[config.addonInstance].api;

async function createItem(type: string, fields: Record<string, string>) {
  const item = new Zotero.Item(type as any);
  for (const [name, value] of Object.entries(fields)) {
    item.setField(name as any, value);
  }
  await item.saveTx();
  return item;
}

async function waitForFulltextMatch(word: string, attachmentID: number) {
  for (let i = 0; i < 20; i++) {
    const search = new Zotero.Search();
    search.addCondition("fulltextContent", "contains", word);
    const ids = await search.search();
    if (ids.includes(attachmentID)) return true;
    await Zotero.Promise.delay(500);
  }
  return false;
}

const AUTO_FETCH_PREF = `${config.prefsPrefix}.autoFetch`;

async function waitForSourceAttachment(item: Zotero.Item, ms: number) {
  for (let waited = 0; waited < ms; waited += 500) {
    const found = item
      .getAttachments()
      .map((id) => Zotero.Items.get(id) as Zotero.Item)
      .find((attachment) => attachment.hasTag("_arxiv-tex"));
    if (found) return found;
    await Zotero.Promise.delay(500);
  }
  return null;
}

describe("tex-fetch", function () {
  this.timeout(120_000);

  // The manual-run tests below would race the automatic fetch.
  before(function () {
    Zotero.Prefs.set(AUTO_FETCH_PREF, false, true);
  });

  it("adds the context menu item", function () {
    const doc = Zotero.getMainWindow().document;
    assert.exists(doc.getElementById("texfetch-itemmenu"));
  });

  it("skips items without an arXiv ID", async function () {
    const item = await createItem("journalArticle", { title: "Not on arXiv" });
    const outcome = await api().fetchSourceForItem(item);
    assert.equal(outcome.status, "no-arxiv-id");
  });

  let attachmentID: number;
  let item: Zotero.Item;

  it("attaches a flattened multi-file source", async function () {
    item = await createItem("preprint", {
      title: "Attention Is All You Need",
      archiveID: "arXiv:1706.03762",
    });
    const outcome = await api().fetchSourceForItem(item);
    assert.equal(outcome.status, "added");
    assert.isAbove(outcome.version, 0);

    const attachment: Zotero.Item = outcome.attachment;
    attachmentID = attachment.id;
    assert.equal(attachment.parentItemID, item.id);
    assert.equal(attachment.attachmentContentType, "text/plain");
    assert.isTrue(attachment.hasTag("_arxiv-tex"));
    assert.equal(
      attachment.getField("title"),
      `arXiv LaTeX source (v${outcome.version})`,
    );

    const text = (await Zotero.File.getContentsAsync(
      (await attachment.getFilePathAsync()) as string,
    )) as string;
    assert.include(text, "% >>> tex-fetch: begin introduction.tex");
    assert.include(text, "\\begin{document}");
  });

  it("indexes the attachment for full-text search", async function () {
    assert.isTrue(await waitForFulltextMatch("Transformer", attachmentID));
  });

  it("reports up to date when the version is unchanged", async function () {
    const outcome = await api().fetchSourceForItem(item);
    assert.equal(outcome.status, "up-to-date");
    assert.equal(outcome.attachment.id, attachmentID);
  });

  it("overwrites the same attachment when a newer version exists", async function () {
    const attachment = Zotero.Items.get(attachmentID) as Zotero.Item;
    attachment.setField("title", "arXiv LaTeX source (v1)");
    await attachment.saveTx();

    const outcome = await api().fetchSourceForItem(item);
    assert.equal(outcome.status, "updated");
    assert.equal(outcome.attachment.id, attachmentID);
    assert.equal(
      (Zotero.Items.get(attachmentID) as Zotero.Item).getField("title"),
      `arXiv LaTeX source (v${outcome.version})`,
    );
    assert.lengthOf(item.getAttachments(), 1);
  });

  it("handles an old-style ID with a single-file source", async function () {
    const old = await createItem("journalArticle", {
      title: "The Large N Limit of Superconformal Field Theories and Supergravity",
      url: "https://arxiv.org/abs/hep-th/9711200",
    });
    const outcome = await api().fetchSourceForItem(old);
    assert.equal(outcome.status, "added");
    const text = (await Zotero.File.getContentsAsync(
      (await outcome.attachment.getFilePathAsync()) as string,
    )) as string;
    assert.include(text, "tex-fetch: flattened LaTeX source of arXiv:hep-th/9711200");
  });

  it("finds the arXiv ID on INSPIRE from the DOI and records it in Extra", async function () {
    const journal = await createItem("journalArticle", {
      title: "On the gluon spectrum in the glasma",
      DOI: "10.1016/j.nuclphysa.2010.06.009",
    });
    const outcome = await api().fetchSourceForItem(journal);
    assert.equal(outcome.status, "added");
    assert.equal(outcome.arxivId, "1005.0955");
    assert.equal(journal.getField("extra"), "arXiv:1005.0955 [hep-ph]");
  });

  it("finds the arXiv ID on INSPIRE from the texkey alone", async function () {
    const journal = await createItem("journalArticle", {
      title: "Parton energy loss in glasma",
      citationKey: "Aurenche:2012qk",
    });
    const outcome = await api().fetchSourceForItem(journal);
    assert.equal(outcome.status, "added");
    assert.equal(outcome.arxivId, "1205.6462");
  });

  it("reports no arXiv ID when INSPIRE has no match", async function () {
    const journal = await createItem("journalArticle", {
      title: "Unknown",
      DOI: "10.9999/does-not-exist.12345",
    });
    const outcome = await api().fetchSourceForItem(journal);
    assert.equal(outcome.status, "no-arxiv-id");
    assert.equal(journal.getField("extra"), "");
  });

  it("fetches automatically for new items when the setting is on", async function () {
    Zotero.Prefs.set(AUTO_FETCH_PREF, true, true);
    try {
      const preprint = await createItem("preprint", {
        title: "Large N",
        archiveID: "arXiv:hep-th/9711200",
      });
      const attachment = await waitForSourceAttachment(preprint, 30_000);
      assert.exists(attachment);
    } finally {
      Zotero.Prefs.set(AUTO_FETCH_PREF, false, true);
    }
  });

  it("does nothing automatically when the setting is off", async function () {
    const preprint = await createItem("preprint", {
      title: "Large N again",
      archiveID: "arXiv:hep-th/9711200",
    });
    assert.isNull(await waitForSourceAttachment(preprint, 8_000));
  });

  describe("bulk", function () {
    let collection: Zotero.Collection;
    let items: Zotero.Item[];

    before(async function () {
      collection = new Zotero.Collection({ name: "Bulk test" } as any);
      await collection.saveTx();
      items = [
        await createItem("journalArticle", {
          title: "Glasma gluon spectrum (bulk)",
          DOI: "10.1016/j.nuclphysa.2010.06.009",
        }),
        await createItem("journalArticle", {
          title: "Parton energy loss (bulk)",
          citationKey: "Aurenche:2012qk",
        }),
        await createItem("journalArticle", { title: "Not on arXiv (bulk)" }),
      ];
      for (const item of items) {
        item.addToCollection(collection.id);
        await item.saveTx();
      }
    });

    it("adds the collection menu item", function () {
      const doc = Zotero.getMainWindow().document;
      assert.exists(doc.getElementById("texfetch-collectionmenu"));
    });

    it("lists the selected collection's items the way the menu does", async function () {
      const pane = Zotero.getActiveZoteroPane()!;
      await (pane.collectionsView as any).selectCollection(collection.id);
      const row = pane.getCollectionTreeRow() as any;
      const ids = ((await row.getItems()) as Zotero.Item[]).map((item) => item.id);
      assert.sameMembers(ids, items.map((item) => item.id));
    });

    it("fetches every item in one run", async function () {
      const counts = await api().fetchInBulk(items, "Bulk test");
      assert.equal(counts.added, 2);
      assert.equal(counts["no-arxiv-id"], 1);
      assert.equal(counts.failed, 0);
    });

    it("downloads nothing on a second run when nothing changed", async function () {
      const urls: string[] = [];
      const http = Zotero.HTTP as any;
      const original = http.request;
      http.request = function (method: string, url: string, ...rest: any[]) {
        urls.push(url);
        return original.call(this, method, url, ...rest);
      };
      try {
        const counts = await api().fetchInBulk(items, "Bulk test");
        assert.equal(counts["up-to-date"], 2);
      } finally {
        http.request = original;
      }
      assert.isEmpty(urls.filter((url) => url.includes("arxiv.org/src/")));
      assert.lengthOf(urls.filter((url) => url.includes("export.arxiv.org/api")), 1);
    });
  });

  it("resolves arXiv IDs for many INSPIRE-style items quickly", async function () {
    // Real records that have a DOI, texkey and arXiv ID, like items imported
    // from INSPIRE.
    const search = await Zotero.HTTP.request(
      "GET",
      "https://inspirehep.net/api/literature?q=t%20glasma&size=80&fields=dois,texkeys,arxiv_eprints",
      { responseType: "json", headers: { Accept: "application/json" } },
    );
    const records = (search.response.hits.hits as any[])
      .map((hit) => hit.metadata)
      .filter((m) => m.dois?.length && m.texkeys?.length && m.arxiv_eprints?.length);
    assert.isAbove(records.length, 50);

    const items: Zotero.Item[] = [];
    await Zotero.DB.executeTransaction(async () => {
      for (const m of records) {
        const item = new Zotero.Item("journalArticle");
        item.setField("title", `INSPIRE batch ${m.texkeys[0]}`);
        item.setField("DOI", m.dois[0].value);
        item.setField("citationKey" as any, m.texkeys[0]);
        await item.save();
        items.push(item);
      }
    });

    const urls: string[] = [];
    const http = Zotero.HTTP as any;
    const original = http.request;
    http.request = function (method: string, url: string, ...rest: any[]) {
      urls.push(url);
      return original.call(this, method, url, ...rest);
    };
    const started = Date.now();
    let ids: Map<number, string>;
    try {
      ids = await api().resolveArxivIds(items);
    } finally {
      http.request = original;
    }

    assert.isBelow(Date.now() - started, 30_000);
    assert.isAbove(urls.length, 1, "lookups should be split into several requests");
    for (const [i, item] of items.entries()) {
      assert.equal(ids.get(item.id), records[i].arxiv_eprints[0].value);
      assert.match(item.getField("extra") as string, /^arXiv:/);
    }
  });
});

