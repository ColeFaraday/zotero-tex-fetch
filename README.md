# tex-fetch

Zotero plugin that attaches the arXiv LaTeX source of a paper as a single
flattened `.tex` file (child attachment titled `arXiv LaTeX source (vN)`,
tagged `_arxiv-tex`, indexed as plain text), so AI agents can read papers
without parsing the PDF. Items without arXiv metadata are looked up on
INSPIRE by DOI or texkey, and the ID found is written to Extra. See
[PLAN.md](PLAN.md).

New items get their source automatically (Settings → tex-fetch to turn this
off; items synced from other devices are skipped). For existing items,
right-click items → **Fetch arXiv LaTeX source**, or right-click a collection,
saved search or My Library → **Fetch arXiv LaTeX source for this …**. Running
it again replaces an attachment's contents in place when arXiv has a newer
version; papers already up to date aren't downloaded again.

## Development

```bash
npm install
cp .env.example .env
npm run build   # → .scaffold/build/tex-fetch.xpi
npm test        # runs test/ inside a separate Zotero instance, hits arXiv
```

Keep `ZOTERO_PLUGIN_KILL_COMMAND = true` in `.env`: without it the scaffold
runs `kill -9` on every process named "zotero" when it exits, including your
everyday Zotero.

## Releasing

```bash
npm run release
```

This asks for the new version, then commits, tags `vX.Y.Z` and pushes. The tag
starts the Release workflow, which builds the `.xpi`, attaches it to a GitHub
release and updates `update.json` on the `release` tag (where installed copies
check for updates).

