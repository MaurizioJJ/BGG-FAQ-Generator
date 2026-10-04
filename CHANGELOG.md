# Changelog

## Unreleased

- Added Gemini as a third provider: a session-only Gemini API key in Settings,
  Gemini 3.8 Flash (default), 3.1 Pro preview, and 3.5 Flash-Lite with pricing,
  and the `generateContent` API with the key sent in a header. Thinking tokens
  are included in the reported cost; safety blocks fail once without retrying.
- Added a Claude/OpenAI provider picker with current per-provider model choices,
  separate session-only API keys, provider-aware consent, pricing, resumable
  checkpoints, and OpenAI Responses API support with response storage disabled.
- Explicitly disabled GPT-5.6 implicit prompt-cache writes because current cache
  writes cost more than ordinary input; no paid caching is enabled by default.
- Collapsed each finished scrape step into a one-line summary with a **Change**
  button, and scrolled the next step into view. On a game with eight forums this
  moves **Start scrape** from 1236px down the page to 608px and nearly halves the
  height of the tab, so configuring a scrape no longer means scrolling past the
  search box and the full forum list.
- Replaced the growing scrape log with a pinned progress summary (counter,
  current thread, time remaining) and moved the per-thread log behind a
  collapsible **Scrape details** toggle, capped at the most recent 200 lines.
- Added an end-of-scrape result panel with explicit next steps: **Generate FAQ**,
  **Open Library**, and **Retry missing threads**. Failed threads are now
  reported instead of only being recorded in storage.
- Updated the model picker to `claude-opus-5` (default), `claude-sonnet-5`, and
  `claude-haiku-4-5`, with per-model pricing and per-model chunk sizes.
- Removed `temperature` from requests, which current models reject, and send
  `output_config.effort` only to models known to accept it.
- FAQ generation now saves each completed extraction part, so an interrupted run
  can be resumed instead of discarding requests that were already billed.
  Successful runs report the actual cost from reported token usage.
- Clarified labels: Library **Use** is now **Generate FAQ** / **Open FAQ**, and
  *Import an earlier v2 FAQ* is now **Reopen an exported FAQ file** with an
  explanation of the embedded source data.
- Fixed a stale FAQ body remaining on screen after switching to a dataset with no
  generated FAQ.
- Fixed non-retryable Anthropic responses (400 and other 4xx) being retried three
  extra times with backoff, which turned one bad model ID into four failed
  requests and a long wait.

## 2.0.0 — 2026-07-16

- Rebuilt the extension as safe, dependency-free ES modules.
- Added robust BGG and Anthropic request validation, timeouts, retry/backoff, and cancellation.
- Added thread-aware FAQ chunking, source-linked answers, conflict handling, configurable models, and cost estimates.
- Added IndexedDB datasets, per-thread scrape checkpoints, update scraping, complete library backup/restore, and resumable workflows.
- Added session-only credentials by default, optional remembered credentials, and credential clearing.
- Added scrape filters, author filtering, Markdown/HTML/text/JSON exports, v2 FAQ round trips, and printable HTML.
- Added BGG attribution, privacy/compliance notices, automated tests, secret checks, and GitHub Actions validation.
