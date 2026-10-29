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

describe("tex-fetch", function () {
  this.timeout(120_000);

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
});
