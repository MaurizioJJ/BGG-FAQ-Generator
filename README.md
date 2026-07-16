# BGG FAQ Generator

BGG FAQ Generator is a dependency-free Chrome extension for collecting BoardGameGeek forum discussions and turning rules answers into a downloadable Markdown FAQ with Claude.

It runs as a Chrome side panel and uses the BoardGameGeek XML API v2 to search games, list forums, and retrieve threads.

## What it does

- Searches BoardGameGeek by game name and optional publication year.
- Lists the forums available for the selected game.
- Scrapes a complete forum or fetches only thread IDs missing from an earlier scrape.
- Downloads the collected material as plain text or JSON.
- Sends the selected forum corpus to the Anthropic Messages API and generates a structured FAQ.
- Downloads the generated FAQ as Markdown.
- Stores game summaries locally so they can be reopened later.

## Requirements

- Google Chrome with support for Manifest V3 and the Side Panel API.
- A BoardGameGeek bearer token.
- An Anthropic API key if you want to generate FAQs. Scraping and exporting do not require an Anthropic key.

Use of the external services is subject to their respective terms, rate limits, and usage charges.

## Install from source

1. Clone this repository:

   ```bash
   git clone https://github.com/MaurizioJJ/BGG-FAQ-Generator.git
   ```

2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the cloned `BGG-FAQ-Generator` directory.
6. Select the extension icon to open its side panel.
7. Open **Config**, enter your credentials, and select **Save**.

After pulling or editing the source, use the **Reload** button on `chrome://extensions` to apply the changes.

## Usage

1. On **Scrape**, search for a game and select the correct result.
2. Select a forum and choose either a full or update scrape.
3. Review the estimated request count and confirm the scrape.
4. Download the results as `.txt` or `.json`, or continue to **FAQ**.
5. Add optional generation instructions and select **Generate FAQ**.
6. Review the result and download it as Markdown.

The extension pauses between BoardGameGeek requests to reduce request pressure. Large forums and multi-part Claude requests can take time and can incur Anthropic API usage charges.

## Privacy and security

- No credentials are committed to this repository.
- The BGG token and Anthropic API key entered in **Config** are saved in `chrome.storage.local` in the local Chrome profile.
- The Anthropic key is sent only to `https://api.anthropic.com` when generating a FAQ.
- Scraped BGG posts are sent to Anthropic when generating a FAQ. Do not use that feature with content you are not permitted to process.
- Saved-game entries contain game/forum metadata and thread counts, not the complete scraped post corpus.
- Downloaded text, JSON, and Markdown files remain wherever the browser saves them.

Anyone with access to the unlocked Chrome profile may be able to inspect extension storage. Use a restricted API key, monitor its usage, and remove stored credentials before sharing the browser profile.

## Permissions

The manifest requests:

| Permission | Purpose |
| --- | --- |
| `storage` | Store credentials and saved-game metadata in the local Chrome profile. |
| `sidePanel` | Display the extension interface in Chrome's side panel. |
| `https://boardgamegeek.com/*` | Search games and retrieve forum/thread data. |
| `https://api.anthropic.com/*` | Generate FAQs with the Anthropic Messages API. |

No analytics or telemetry code is included.

## Project structure

```text
.
├── background.js       # Opens the side panel from the toolbar action
├── manifest.json       # Manifest V3 configuration and permissions
├── sidepanel.html      # Side-panel markup and styles
├── sidepanel.js        # BGG scraping, local storage, export, and FAQ logic
└── icons/              # Extension icons
```

There is no build step or package manager. The checked-in files are the files Chrome loads.

## Source provenance

This repository was initialized on 16 July 2026 from the existing unpacked extension directory `bgg-faq-extension`. The extension source files and icons in the initial commit are the contents of that local add-on directory; only repository documentation and ignore rules were added during import.

The local files did not contain an upstream repository reference, author notice, license notice, or recoverable macOS download-source URL. Consequently, history and authorship before this import are not established by this repository. If an upstream source is identified later, it should be credited here and its license preserved.

## Development checks

The JavaScript and manifest can be checked without installing dependencies:

```bash
node --check background.js
node --check sidepanel.js
jq empty manifest.json
```

For functional testing, load the directory as an unpacked extension and exercise the search, scrape, export, and FAQ flows with test credentials.

## Disclaimer

This is an independent utility and is not affiliated with or endorsed by BoardGameGeek or Anthropic. Generated FAQs may contain errors; verify rules answers against the game's official rules and authoritative clarifications.

