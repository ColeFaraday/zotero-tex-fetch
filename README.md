# tex-fetch

Zotero plugin that attaches the arXiv LaTeX source of a paper as a single
flattened `.tex` file (child attachment titled `arXiv LaTeX source (vN)`,
tagged `_arxiv-tex`, indexed as plain text), so AI agents can read papers
without parsing the PDF. Items without arXiv metadata are looked up on
INSPIRE by DOI or texkey, and the ID found is written to Extra. See
[PLAN.md](PLAN.md).

Right-click items → **Fetch arXiv LaTeX source**. Running it again replaces
the attachment's contents in place when arXiv has a newer version.

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
