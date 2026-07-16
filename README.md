# BGG FAQ Generator

A Chrome extension that scrapes BoardGameGeek discussion forums and turns the collected rules discussions into a Markdown FAQ with Claude.

## Features

- Search BoardGameGeek for a game and select one of its forums.
- Scrape all threads or update a previously saved scrape.
- Download the collected discussions as text or JSON.
- Generate and download a deduplicated Markdown FAQ with the Anthropic API.
- Keep the UI available in Chrome's side panel.

## Install from source

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose this repository's directory.
5. Open the extension and add your BoardGameGeek bearer token and Anthropic API key on the **Config** tab.

The credentials are stored locally by Chrome and are not included in this repository.

## Permissions

The extension uses Chrome local storage and the side panel API. Network access is limited to BoardGameGeek and Anthropic API endpoints, as declared in `manifest.json`.

## Development

This is a dependency-free Manifest V3 extension. After changing a file, reload the extension from `chrome://extensions`.

