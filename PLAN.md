# tex-fetch: plan

A Zotero 10 plugin that attaches the arXiv LaTeX source of each arXiv item as a
single flattened, plain-text `.tex` file, so AI agents can read papers without
going through the PDF.

Tooling: `zotero-plugin-scaffold` (TypeScript), same as `../zotero-cita`.

## Pipeline

1. **Detect the arXiv ID**, in order: `Archive ID` (`arXiv:…`), DOI
   `10.48550/arXiv.*`, `Extra` (`arXiv: …`), `arxiv.org/abs|pdf/…` URL. Support
   old-style IDs (`hep-th/9901001`). Strip any version suffix: we always
   want the latest version.
   - **Fallback: INSPIRE.** Journal items imported from INSPIRE have only a DOI
     and a texkey (`citationKey`). Query
     `inspirehep.net/api/literature?q=doi:"…" or texkeys:"…"` and read
     `arxiv_eprints`. Write the result to Extra as `arXiv:1005.0955 [hep-ph]`,
     the same format zotero-inspire uses, so later runs skip the lookup. For
     bulk runs, one query can OR together many DOIs and texkeys.
2. **Look up the latest version** through the arXiv API
   (`export.arxiv.org/api/query?id_list=…`). It accepts many IDs per request,
   so a bulk run makes one call per batch, not one per item.
3. **Compare** with the version already attached (recorded on the attachment,
   e.g. title `arXiv LaTeX source (v3)`). If it's the same, skip.
4. **Fetch** `https://arxiv.org/e-print/<id>v<N>`, rate-limited to ~1
   request per 3 s. Response forms:
   - gzipped tar: the usual multi-file project
   - single gzipped `.tex`
   - PDF (PDF-only submission): skip, no fallback, record it so we don't retry
5. **Unpack in memory**: `DecompressionStream('gzip')` plus a small tar reader.
   No dependencies.
6. **Flatten**:
   - find the main file: `00README` if present, otherwise the file with
     `\documentclass` and `\begin{document}`
   - recursively inline `\input`, `\include`, `\subfile`, `\import`
     (paths may omit the extension or sit in subdirectories)
   - inline the `.bbl` so resolved references are present
   - replace figures with markers like `% [figure: fig3.pdf]`
   - decode as UTF-8, falling back to latin-1
   - leave comments as they are
7. **Attach**: one stored child attachment, `text/plain` (so Zotero
   full-text indexes it), titled `arXiv LaTeX source (vN)`, tagged
   `_arxiv-tex`. The raw source archive is not kept.
   - **On a new version**, overwrite the existing attachment's file in place,
     update its title, and re-index. The attachment key stays the same and
     nothing goes to the trash.

## Triggers

- Context menu → **Fetch arXiv source** (selected items)
- **Update collection / library** (bulk, with progress window). This also
  picks up new versions of items fetched earlier.
- **Auto-fetch on item add** (via Notifier, after a short delay so translators
  can finish filling in metadata). Items arriving by sync are skipped: the
  device that added them may already have attached the source.

## Settings

- auto-fetch on add (on/off)
- inline `.bbl` (default on)

## Milestones

1. ✅ Scaffold and context-menu action, ending with one paper attached end to end.
   Verify `DecompressionStream` exists and that `text/plain` attachments are
   indexed.
2. Node unit tests for the tar reader and the flattener, using real e-print
   fixtures (multi-file, single-file, nested `\input`, latin-1, PDF-only).
3. ✅ In-place update, auto-on-add, settings pane, version check through the
   arXiv API before downloading, bulk mode for a collection, saved search or
   library (batched INSPIRE and arXiv API lookups, one summary line, stop from
   the same menu).
4. Agent check: does the Zotero MCP's `zotero_get_item_fulltext` return the
   `.tex` or the PDF text? If it returns the PDF, document the
   `zotero_get_attachment_path` route.
