import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildChunks, estimateGeneration, generationPlan, usageCost, generateFaq, serverRetryDelayMs, MODELS, DEFAULT_MODEL, DEFAULT_MODELS, modelsFor } from '../src/anthropic-api.js';
import { faqMarkdown, importFaqMarkdown, datasetText, filenames } from '../src/exports.js';
import { approximateTokens, escapeHtml, slug, uniqueCsv } from '../src/utils.js';

const dataset = {
  id: '1-2', schemaVersion: 2, game: { id: '1', name: 'Test & Game', year: '2026' },
  forum: { id: '2', title: 'Rules', numThreads: 1 }, updatedAt: '2026-07-16T00:00:00.000Z',
  scrape: { status: 'complete', completedAt: '2026-07-16T00:00:00.000Z', filters: {}, pendingIds: [] },
  threads: [{ id: '3', subject: 'Scoring?', url: 'https://boardgamegeek.com/thread/3', posts: [
    { id: '4', author: 'designer', date: '2026-01-01', body: 'Score two points.', url: 'https://boardgamegeek.com/thread/3#4' }
  ]}],
  faq: { text: '## Scoring\n\n**Q:** How?\n\n**A:** Two points. [Source](https://boardgamegeek.com/thread/3#4)', model: 'claude-opus-5', generatedAt: '2026-07-16T00:00:00.000Z' }
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
  assert.equal(estimate.requests, 1);
  assert.ok(estimate.inputTokens > 0);
  assert.ok(estimate.estimatedUsd > 0);
});

test('the default model is a current model and every model is priced', () => {
  assert.equal(DEFAULT_MODEL, 'claude-opus-5');
  assert.equal(DEFAULT_MODELS.openai, 'gpt-5.6-terra');
  assert.ok(MODELS.every(model => model.inputUsd > 0 && model.outputUsd > 0 && model.chunkTokens > 0));
  assert.deepEqual(modelsFor('anthropic').map(model => model.id), ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']);
  assert.deepEqual(modelsFor('openai').map(model => model.id), ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  assert.equal(DEFAULT_MODELS.gemini, 'gemini-3.8-flash');
  assert.deepEqual(modelsFor('gemini').map(model => model.id), ['gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']);
});

test('cost estimates follow the selected model and are omitted for custom IDs', () => {
  const opus = estimateGeneration(dataset.threads, 'claude-opus-5');
  const haiku = estimateGeneration(dataset.threads, 'claude-haiku-4-5');
  assert.ok(haiku.estimatedUsd < opus.estimatedUsd);
  assert.equal(estimateGeneration(dataset.threads, 'claude-experimental-x').estimatedUsd, null);
});

test('actual cost is derived from reported usage', () => {
  assert.equal(usageCost('claude-opus-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 30);
  assert.equal(usageCost('claude-experimental-x', { input_tokens: 10 }), null);
  assert.equal(usageCost('claude-opus-5', {}), null);
});

test('a generation plan describes the work saved parts must match', () => {
  const plan = generationPlan(dataset, 'claude-opus-5');
  assert.equal(plan.chunkTotal, 1);
  assert.equal(plan.model, 'claude-opus-5');
  assert.equal(plan.provider, 'anthropic');
  // A custom model uses the conservative chunk size, so its plan may differ from
  // a saved one -- which is exactly why resuming re-checks the chunk count.
  assert.ok(generationPlan(dataset, 'claude-custom').chunkTotal >= 1);
});

test('Anthropic requests omit parameters the current models reject', async () => {
  const source = await readFile(new URL('../src/anthropic-api.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('function anthropicRequestBody'), source.indexOf('function openaiRequestBody'))
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(body, /temperature/);
  assert.match(body, /max_tokens/);
  assert.match(body, /output_config/);
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

test('fictional demo backup contains three safe v2 datasets', async () => {
  const text = await readFile(new URL('../demo-data/fictional-library-backup.json', import.meta.url), 'utf8');
  const backup = JSON.parse(text);
  assert.equal(backup.schemaVersion, 2);
  assert.equal(backup.datasets.length, 3);
  assert.ok(backup.datasets.every(item => item.schemaVersion === 2 && item.id && item.threads.length));
  assert.doesNotMatch(text, /boardgamegeek\.com\/thread|sk-ant-|gh[pousr]_/i);
  assert.match(text, /example\.invalid/);
});

function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push(JSON.parse(options.body)); return handler(calls.length); };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const okResponse = () => new Response(JSON.stringify({
  content: [{ type: 'text', text: '**A:** Two points. [Source](https://boardgamegeek.com/thread/3#4)' }],
  usage: { input_tokens: 100, output_tokens: 10 }, stop_reason: 'end_turn'
}), { status: 200 });

test('a rejected request is not retried, so a bad model ID fails once', async () => {
  const stub = stubFetch(() => new Response(JSON.stringify({ error: { message: 'invalid model' } }), { status: 400 }));
  try {
    await assert.rejects(
      generateFaq({ dataset, apiKey: 'k', model: 'claude-opus-5' }),
      /invalid model/
    );
    assert.equal(stub.calls.length, 1);
  } finally { stub.restore(); }
});

test('OpenAI uses Responses API format and disables paid implicit cache writes', async () => {
  const stub = stubFetch(() => new Response(JSON.stringify({
    output_text: '**A:** Two points. [Source](https://boardgamegeek.com/thread/3#4)',
    usage: { input_tokens: 100, output_tokens: 10 }
  }), { status: 200 }));
  try {
    const faq = await generateFaq({ dataset, provider: 'openai', apiKey: 'k', model: 'gpt-5.6-terra' });
    assert.equal(stub.calls[0].model, 'gpt-5.6-terra');
    assert.equal(stub.calls[0].store, false);
    assert.deepEqual(stub.calls[0].prompt_cache_options, { mode: 'explicit' });
    assert.equal(faq.provider, 'openai');
    assert.match(faq.text, /Two points/);
  } finally { stub.restore(); }
});

test('Gemini uses generateContent with a header key and bills thinking tokens as output', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [
        { text: 'internal reasoning', thought: true },
        { text: '**A:** Two points. [Source](https://boardgamegeek.com/thread/3#4)' }
      ] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 5 }
    }), { status: 200 });
  };
  try {
    const faq = await generateFaq({ dataset, provider: 'gemini', apiKey: 'gk', model: 'gemini-3.8-flash' });
    assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    assert.equal(calls[0].headers['x-goog-api-key'], 'gk');
    assert.ok(!calls[0].url.includes('key='));
    assert.deepEqual(calls[0].body.generationConfig, { maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: 'low' } });
    assert.equal(calls[0].body.contents[0].role, 'user');
    assert.equal(faq.provider, 'gemini');
    assert.doesNotMatch(faq.text, /internal reasoning/);
    assert.deepEqual(faq.usage, { input_tokens: 100, output_tokens: 15 });
    assert.ok(usageCost('gemini-3.8-flash', faq.usage, 'gemini') > 0);
  } finally { globalThis.fetch = original; }
});

test('a Gemini safety block fails once instead of retrying', async () => {
  const stub = stubFetch(() => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 }));
  try {
    await assert.rejects(generateFaq({ dataset, provider: 'gemini', apiKey: 'k', model: 'gemini-3.8-flash' }), /Google declined/);
    assert.equal(stub.calls.length, 1);
  } finally { stub.restore(); }
});

const rateLimited = retryDelay => new Response(JSON.stringify({ error: {
  code: 429, message: 'Quota exceeded for input tokens per minute.',
  details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }]
} }), { status: 429 });
const geminiOk = () => new Response(JSON.stringify({
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '**A:** Two points. [Source](https://boardgamegeek.com/thread/3#4)' }] } }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 }
}), { status: 200 });

test('a 429 waits the delay the server asks for, then retries', async () => {
  const stub = stubFetch(count => count === 1 ? rateLimited('0s') : geminiOk());
  const progress = [];
  try {
    const faq = await generateFaq({ dataset, provider: 'gemini', apiKey: 'k', model: 'gemini-3.8-flash', onProgress: (_, __, label) => progress.push(label) });
    assert.equal(stub.calls.length, 2);
    assert.ok(progress.includes('Rate limit reached; retrying in 1s'));
    assert.match(faq.text, /Two points/);
  } finally { stub.restore(); }
});

test('a 429 asking for a long wait fails at once with the server message', async () => {
  const stub = stubFetch(() => rateLimited('3600s'));
  try {
    await assert.rejects(generateFaq({ dataset, provider: 'gemini', apiKey: 'k', model: 'gemini-3.8-flash' }), /Quota exceeded/);
    assert.equal(stub.calls.length, 1);
  } finally { stub.restore(); }
});

test('the retry delay is read from RetryInfo or Retry-After', () => {
  assert.equal(serverRetryDelayMs(new Response('{}'), { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37.2s' }] } }), 37200);
  assert.equal(serverRetryDelayMs(new Response('{}', { headers: { 'retry-after': '20' } }), {}), 20000);
  assert.equal(serverRetryDelayMs(new Response('{}'), {}), null);
});

test('each completed part is handed back for persistence before the next request', async () => {
  const stub = stubFetch(() => okResponse());
  const persisted = [];
  try {
    const faq = await generateFaq({
      dataset, apiKey: 'k', model: 'claude-opus-5',
      onPart: (parts, meta) => { persisted.push({ count: parts.length, chunkTotal: meta.chunkTotal, model: meta.model }); }
    });
    assert.equal(persisted.length, 1);
    assert.deepEqual(persisted[0], { count: 1, chunkTotal: 1, model: 'claude-opus-5' });
    assert.equal(faq.usage.input_tokens, 100);
    assert.match(faq.text, /boardgamegeek\.com\/thread/);
  } finally { stub.restore(); }
});

test('saved parts are reused instead of re-requested when resuming', async () => {
  const stub = stubFetch(() => okResponse());
  try {
    // The single chunk is already covered by a saved part, so no extraction
    // request should be sent at all.
    const faq = await generateFaq({
      dataset, apiKey: 'k', model: 'claude-opus-5',
      startParts: ['**A:** Two points. [Source](https://boardgamegeek.com/thread/3#4)']
    });
    assert.equal(stub.calls.length, 0);
    assert.match(faq.text, /Two points/);
  } finally { stub.restore(); }
});

test('billable AI keys remain session-only unless separately opted in', async () => {
  const local = {};
  const session = {};
  const area = values => ({
    get: async keys => Object.fromEntries(keys.filter(key => key in values).map(key => [key, values[key]])),
    set: async entries => Object.assign(values, entries),
    remove: async keys => { for (const key of keys) delete values[key]; }
  });
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { storage: { local: area(local), session: area(session) } };
  try {
    const { saveCredentials, loadCredentials } = await import(`../src/storage.js?test=${Date.now()}`);
    await saveCredentials({ bggToken: 'bgg', anthropicKey: 'ant', openaiKey: 'oai', geminiKey: 'gem', remember: true });
    assert.deepEqual(local, { bggToken: 'bgg', rememberCredentials: true, rememberAiKeys: false });
    assert.deepEqual(session, { bggToken: 'bgg', anthropicKey: 'ant', openaiKey: 'oai', geminiKey: 'gem' });
    assert.deepEqual(await loadCredentials(), { bggToken: 'bgg', anthropicKey: 'ant', openaiKey: 'oai', geminiKey: 'gem', remember: true, rememberAiKeys: false });
    // A key left on disk by an older version is purged when not opted in.
    local.openaiKey = 'stale';
    await loadCredentials();
    assert.ok(!('openaiKey' in local));
  } finally { globalThis.chrome = originalChrome; }
});

test('AI keys survive a Chrome restart only when the owner opts in', async () => {
  const local = {};
  let session = {};
  const area = values => ({
    get: async keys => Object.fromEntries(keys.filter(key => key in values).map(key => [key, values[key]])),
    set: async entries => Object.assign(values, entries),
    remove: async keys => { for (const key of keys) delete values[key]; }
  });
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { storage: { local: area(local), session: area(session) } };
  try {
    const { saveCredentials, loadCredentials, clearCredentials } = await import(`../src/storage.js?test=optin${Date.now()}`);
    await saveCredentials({ bggToken: 'bgg', anthropicKey: 'ant', openaiKey: '', geminiKey: 'gem', remember: false, rememberAiKeys: true });
    session = {}; globalThis.chrome.storage.session = area(session); // simulate a restart
    const loaded = await loadCredentials();
    assert.equal(loaded.geminiKey, 'gem');
    assert.equal(loaded.anthropicKey, 'ant');
    assert.equal(loaded.bggToken, '');
    assert.equal(loaded.rememberAiKeys, true);
    await clearCredentials();
    assert.deepEqual(local, {});
  } finally { globalThis.chrome = originalChrome; }
});
