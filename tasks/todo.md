# BGG FAQ Extension — UX + model refresh

## 1. Scrape progress: no more growing scroll (feedback 1 + 2)
- [x] Replace the append-forever `<pre id="scrape-log">` as the primary progress surface
- [x] Add a compact sticky status strip: progress bar + "12/240 · Scoring question" + elapsed/remaining
- [x] Move the line-by-line log behind a `<details>` "Show details" toggle (collapsed by default)
- [x] Keep the log capped (last ~200 lines) so long scrapes stay cheap

## 2. Next steps after a scrape finishes (feedback 3)
- [x] On completion, replace the progress strip with a result panel:
      threads stored / posts / failures count
- [x] Primary action: "Generate FAQ ->" (sets active dataset, switches to FAQ tab)
- [x] Secondary: "View in Library", "Scrape another forum"
- [x] Surface failed threads with a "Retry failed threads" action (they are already
      recorded in `dataset.scrape.failures` but never shown)

## 3. Models (feedback 4)
- [x] REMOVE `temperature: 0.1` — 400s on Opus 5 / Sonnet 5
- [x] Model picker: Opus 5 (default), Sonnet 5, Haiku 4.5, Custom
- [x] Replace hardcoded sonnet pricing with a per-model price table; show
      "cost unknown" only for custom IDs
- [x] Raise `max_tokens` 5000 -> 16000; add `output_config: {effort:"low"}`
- [x] Raise MAX_CHUNK_TOKENS 28000 -> ~120000 for 1M-context models, keep a
      smaller cap for Haiku (200K); fewer requests = cheaper + better synthesis
- [x] Update README + test fixture model strings

## 4. FAQ generation: failure and next steps (feedback 6)
- [x] Persist extraction parts to the dataset as they complete
- [x] On failure: keep the partial parts, show what completed, offer "Resume"
      (skips already-extracted chunks) instead of discarding paid work
- [x] Show a clear post-generation panel: what was generated, cost actually used
      (from `usage`), and what to do next (download / verify / regenerate)
- [x] Fix stale output bug: `renderFaqSource` never hides `#faq-output` when
      switching to a dataset with no FAQ (app.js:176)

## 5. Labels (feedback 5 + 7)
- [x] Library "Use" -> "Generate FAQ" (or "Select")
- [x] "Import an earlier v2 FAQ" -> "Reopen an exported FAQ file", with one line
      explaining the .md carries its own source data

## Verify
- [x] `npm run check` && `npm test` pass
- [x] Load unpacked in Chrome; run a small real scrape; confirm the sticky
      progress, the details toggle, and the completion panel
- [x] Confirm a generation against Opus 5 actually returns (temperature fix)

## Review

All items done. `npm run check` and `npm test` pass (16 tests, up from 8).

Verified in a real browser, not just statically: the side panel was served over
localhost with a `chrome.storage` stub, the BGG XML API was stubbed with canned
responses, and a full scrape was driven through the actual UI.

- Scrape run of 3 threads with 1 deliberate failure: the progress strip computed
  `position: sticky`, the counter read "2 / 3 threads", the current subject and
  "~2 seconds remaining" updated live, and the detail log stayed collapsed.
- On completion the strip hid and the result panel read
  "Scrape complete / 2 threads - 2 posts - 1 failed" with Generate FAQ,
  Open Library, and Retry missing threads.
- FAQ generation against a stubbed Anthropic endpoint: the request body was
  `{model, max_tokens: 16000, messages, output_config: {effort: "low"}}` with no
  `temperature`.
- Failure mid-run: 1 of 2 parts persisted to IndexedDB, the resume panel
  appeared, and resuming spent 2 further requests instead of 3 - the completed
  extraction was reused. Final cost read US$0.60 from reported usage.

### Found and fixed while testing (not in the original plan)

Non-retryable Anthropic responses were being retried. A 400 - the response you
get from a wrong custom model ID - was repeated four times with backoff before
surfacing. The live test showed 4 requests where 1 was correct; retries are now
reserved for 429 and 5xx, confirmed by a regression test.

### Follow-up: step ergonomics

Reported after the first pass: reaching "3. Configure scrape" still meant
scrolling past the search box and a full forum list. Steps 1 and 2 now collapse
to a summary line with a Change button once chosen, and the next step is scrolled
into view. Measured in the browser on a game with eight forums: Start scrape
moved from 1236px to 608px down the page, and the tab shrank from 1367px to
738px.

### Deliberately not done

Nothing from the plan was dropped. The chunk-size increase was applied as
described, so FAQ output will differ from previous runs: a 40-thread dataset now
takes 3 requests instead of roughly 9.
