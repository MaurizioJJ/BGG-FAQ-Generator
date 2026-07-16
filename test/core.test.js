import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChunks, estimateGeneration } from '../src/anthropic-api.js';
import { faqMarkdown, importFaqMarkdown, datasetText, filenames } from '../src/exports.js';
import { approximateTokens, escapeHtml, slug, uniqueCsv } from '../src/utils.js';

const dataset = {
  id: '1-2', schemaVersion: 2, game: { id: '1', name: 'Test & Game', year: '2026' },
  forum: { id: '2', title: 'Rules', numThreads: 1 }, updatedAt: '2026-07-16T00:00:00.000Z',
  scrape: { status: 'complete', completedAt: '2026-07-16T00:00:00.000Z', filters: {}, pendingIds: [] },
  threads: [{ id: '3', subject: 'Scoring?', url: 'https://boardgamegeek.com/thread/3', posts: [
    { id: '4', author: 'designer', date: '2026-01-01', body: 'Score two points.', url: 'https://boardgamegeek.com/thread/3#4' }
  ]}],
  faq: { text: '## Scoring\n\n**Q:** How?\n\n**A:** Two points. [Source](https://boardgamegeek.com/thread/3#4)', model: 'claude-sonnet-4-20250514', generatedAt: '2026-07-16T00:00:00.000Z' }
};

test('utility functions normalize and escape input', () => {
  assert.equal(slug('Český & Game'), 'cesky-game');
  assert.equal(escapeHtml('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  assert.deepEqual(uniqueCsv('Alice, bob, ALICE'), ['alice', 'bob']);
  assert.equal(approximateTokens('12345678'), 2);
});

test('thread-aware chunking preserves source links', () => {
  const chunks = buildChunks(dataset.threads, 100);
  assert.equal(chunks.length, 1);
  assert.match(chunks[0], /THREAD 3/);
  assert.match(chunks[0], /boardgamegeek\.com\/thread\/3#4/);
});

test('an oversized post is divided into bounded continuations', () => {
  const oversized = structuredClone(dataset.threads);
  oversized[0].posts[0].body = 'x'.repeat(2000);
  const chunks = buildChunks(oversized, 100);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => approximateTokens(chunk) <= 110));
  assert.match(chunks[1], /CONTINUATION/);
});

test('generation estimate reports at least one request', () => {
  const estimate = estimateGeneration(dataset.threads);
  assert.equal(estimate.chunks, 1);
  assert.ok(estimate.inputTokens > 0);
  assert.ok(estimate.estimatedUsd > 0);
});

test('v2 Markdown export round-trips the complete dataset', () => {
  const markdown = faqMarkdown(dataset);
  const imported = importFaqMarkdown(markdown);
  assert.deepEqual(imported, dataset);
  assert.match(markdown, /BGG-FAQ-V2:/);
});

test('plain-text export contains thread and post sources', () => {
  const text = datasetText(dataset);
  assert.match(text, /THREAD: Scoring\?/);
  assert.match(text, /thread\/3#4/);
  assert.equal(filenames(dataset).md, 'test-game-rules-faq.md');
});

test('invalid FAQ metadata is rejected', () => {
  assert.throws(() => importFaqMarkdown('# ordinary markdown'), /metadata/);
});
