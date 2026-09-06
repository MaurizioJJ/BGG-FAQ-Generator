# BGG FAQ Generator v2

A privacy-conscious Chrome side-panel extension for collecting BoardGameGeek forum discussions and producing source-linked board-game FAQs with Claude or OpenAI.

BGG FAQ Generator is an independent, non-commercial utility. It is not affiliated with or endorsed by BoardGameGeek, Anthropic, or OpenAI.

## Highlights

- Search games and browse forums through the BGG XML API v2.
- Preview and filter a scrape by date, subject, reply count, author, and maximum size.
- Run full or incremental scrapes with cancellation, per-thread checkpoints, and a pinned progress summary with an optional detail log.
- Keep complete reusable datasets in a local scrape library.
- Generate FAQs that retain BGG thread/post links and distinguish conflicts or unresolved answers.
- Estimate model requests, token volume, and per-model cost before generation, and see the actual cost afterwards.
- Resume an interrupted FAQ generation from the parts already paid for.
- Export thread data as text or JSON and FAQs as Markdown or printable HTML.
- Reopen an exported Markdown FAQ, which carries its own source dataset inside the file.
- Back up and restore the entire local library.
- Keep billable AI API keys session-only; optionally remember only the BGG token in the Chrome profile.

## Requirements

- Chrome 114 or later.
- An approved BoardGameGeek application token.
- An Anthropic or OpenAI API key for optional FAQ generation.
- Non-commercial use consistent with the applicable service terms.

Register BGG applications and manage tokens at [boardgamegeek.com/applications](https://boardgamegeek.com/applications). Review the [BGG XML API terms](https://boardgamegeek.com/wiki/page/XML_API_Terms_of_Use) before use.

## Install from source

```bash
git clone <repository-url>
```

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the cloned repository directory.
5. Select the extension toolbar icon to open the side panel.
6. Add credentials under **Settings**.

After pulling a newer revision, select **Reload** on the extension card.

## Workflow

### Scrape

1. Search for a game and select a forum. Each completed step collapses to a
   summary line so the next one stays in view; **Change** reopens it.
2. Choose full or update mode and apply optional filters.
3. Preview the request count and duration.
4. Confirm the scrape. A pinned summary shows the thread counter, the thread being fetched, and the estimated time remaining; **Scrape details** expands the per-thread log.
5. Progress is saved after each thread, so an interrupted dataset remains usable. When the scrape ends, a result panel reports what was stored and offers **Generate FAQ**, **Open Library**, and **Retry missing threads**.

### Generate an FAQ

1. Finish a scrape or select a dataset from **Library**.
2. Choose a model and review the estimated request count and cost.
3. Add optional focus instructions.
4. Confirm the data-transfer notice and generate.
5. Verify the result against its linked BGG sources and the official rulebook.

Each extraction request is saved to the dataset as it completes. If generation is
cancelled, times out, or fails part-way, the finished parts are kept and the FAQ
tab offers **Resume generation**, which continues from the next unprocessed group
instead of paying for the completed ones again. **Discard saved parts** starts
over. After a successful run the panel reports the model, the timestamp, and the
actual cost derived from the reported token usage.

The generator instructs the selected model to preserve disagreements, distinguish unresolved/community answers, and cite the supplied thread/post URLs. Generated output can still be wrong.

### Back up and restore

Use **Back up all data** in Library to download all stored datasets. **Restore backup** merges a v2 backup into the current library. Individual datasets can also be exported as text or JSON.

Markdown FAQ exports contain an encoded metadata comment with the complete dataset, so **Reopen an exported FAQ file** restores both the FAQ and the threads it was built from without rescraping or spending anything. This makes the file self-contained but potentially large; treat it as a copy of the underlying forum material.

### Fictional demo library

To explore Library, FAQ, and export screens without scraping real forum content,
restore `demo-data/fictional-library-backup.json`. It contains three invented
games, fictional discussions, and generated example FAQs. All source links use
the reserved `example.invalid` domain; the file contains no BGG content,
credentials, or user data.

The demo import merges with the local library and can be removed one dataset at
a time. It never loads automatically and does not replace existing datasets.

## Privacy and credentials

- No analytics, telemetry, advertising, or project-operated server is included.
- AI API keys use `chrome.storage.session` and are cleared when the extension reloads, is disabled, updated, or Chrome restarts.
- Enabling **Remember my BGG token** stores only that token in `chrome.storage.local` in the Chrome profile.
- BGG forum content is sent only to the selected provider after the user confirms FAQ generation.
- Complete datasets and checkpoints are stored locally in IndexedDB.

See [PRIVACY.md](PRIVACY.md) for details.

## API behavior

The extension limits host access to:

- `https://boardgamegeek.com/*`
- `https://api.anthropic.com/*`
- `https://api.openai.com/*`

Requests validate HTTP responses and XML, use timeouts, retry only genuinely temporary failures (`202`, `429`, and server errors) with backoff, and support user cancellation. A rejected request, such as an unknown model ID, fails immediately instead of being repeated. The BGG client adds a delay between thread requests to reduce request pressure.

The provider and model pickers offer Claude (`claude-opus-5` by default,
`claude-sonnet-5`, and `claude-haiku-4-5`) or OpenAI (`gpt-5.6-terra` by
default, `gpt-5.6-sol`, and `gpt-5.6-luna`), plus a custom model ID. Claude requests send `max_tokens`
and, for models known to accept it, `output_config.effort`; `temperature` is not
sent because current models reject it. Source material is chunked to the selected
model's context window, so the 1M-context models need far fewer requests than
`claude-haiku-4-5`. A custom model ID uses a conservative chunk size and reports
no cost estimate. OpenAI requests use the Responses API with response storage
disabled. Prompt caching is not enabled: current GPT-5.6 cache writes cost more
than ordinary input, so enabling them by default would violate the no-extra-cost
rule. Price estimates are informational and may become outdated.

## Development

The extension has no runtime dependencies and no build step.

```text
.
├── background.js
├── manifest.json
├── sidepanel.html
├── styles.css
├── src/
│   ├── anthropic-api.js
│   ├── app.js
│   ├── bgg-api.js
│   ├── exports.js
│   ├── storage.js
│   └── utils.js
└── test/
```

Run validation with Node 20 or newer:

```bash
npm run check
npm test
```

GitHub Actions runs the same checks and scans tracked files for common credential patterns.

## Source provenance and licensing

The repository originated from an unpacked extension directory that contained
no upstream repository reference, author notice, license notice, or recoverable
download-source URL. The earlier authorship and license therefore remain
unestablished.

V2 is a substantial rewrite, but no license is asserted for the inherited icons or earlier source until provenance is resolved. Do not redistribute or publish to an extension marketplace without resolving those rights and confirming BGG application approval and attribution requirements.

## Terms and attribution

BoardGameGeek is credited in the extension UI and exports. BGG currently requires registration for nearly all XML API use, imposes usage and licensing conditions, restricts API data to authorized uses, and requires public-facing attribution. Users are responsible for checking the latest terms and whether their AI-assisted processing is permitted for their intended use.

See [CHANGELOG.md](CHANGELOG.md) for release details.
