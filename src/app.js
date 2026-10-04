import { searchGames, getForums, getForumThreads, getThread } from './bgg-api.js';
import { datasets, loadCredentials, saveCredentials, clearCredentials, exportBackup, importBackup } from './storage.js';
import { PROVIDERS, DEFAULT_PROVIDER, providerInfo, DEFAULT_MODELS, modelsFor, usageCost, estimateGeneration, generationPlan, generateFaq } from './anthropic-api.js';
import { faqMarkdown, faqHtml, importFaqMarkdown, datasetJson, datasetText, filenames } from './exports.js';
import { download, element, formatDuration, safeDate, setChildren, uniqueCsv } from './utils.js';

const $ = id => document.getElementById(id);
const LOG_LINE_LIMIT = 200;
const state = {
  game: null, forum: null, threadMeta: [], prepared: [], activeDataset: null,
  scrapeController: null, faqController: null, logLines: [], faqError: ''
};

function setStatus(text, type = 'neutral') { $('global-status').textContent = text; $('global-status').className = `status ${type}`; }
function show(id, visible = true) { $(id).classList.toggle('hidden', !visible); }
function bar(id, current, total) { $(id).firstElementChild.style.width = `${total ? Math.min(100, current / total * 100) : 0}%`; }
function toast(message) { $('toast').textContent = message; show('toast'); setTimeout(() => show('toast', false), 4000); }
function errorMessage(error) { return error?.message || String(error); }

function log(message) {
  state.logLines.push(`[${new Date().toLocaleTimeString()}] ${message}`);
  if (state.logLines.length > LOG_LINE_LIMIT) state.logLines.splice(0, state.logLines.length - LOG_LINE_LIMIT);
  $('scrape-log').textContent = state.logLines.join('\n');
  $('scrape-log').scrollTop = $('scrape-log').scrollHeight;
}

function notice(id, type, ...children) {
  const node = $(id);
  node.className = `notice ${type}`;
  setChildren(node, ...children);
  show(id);
}

function summaryBlock(title, detail) {
  return element('div', { className: 'result-summary' }, element('strong', { text: title }), element('span', { text: detail }));
}

/** Collapses a finished step to a one-line summary so the next step stays in view. */
function collapseStep(card, summaryId, text) {
  $(card).classList.add('collapsed');
  $(summaryId).textContent = text; show(summaryId);
  show(`edit-${card.replace('-card', '')}`);
}

function expandStep(card, summaryId) {
  $(card).classList.remove('collapsed');
  show(summaryId, false); show(`edit-${card.replace('-card', '')}`, false);
  reveal(card);
}

function reveal(id) {
  requestAnimationFrame(() => $(id).scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function activateTab(name) {
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
  if (name === 'library') renderLibrary();
  if (name === 'faq') renderFaqSource();
}

async function credentials(provider = null) {
  const values = await loadCredentials();
  if (!values.bggToken) { activateTab('settings'); throw new Error('Add a BGG application token in Settings.'); }
  const info = providerInfo(provider);
  if (info && !values[info.keyField]) { activateTab('settings'); throw new Error(`Add a ${info.name} API key in Settings.`); }
  return values;
}

function selectResult(container, selected) {
  container.querySelectorAll('.result').forEach(result => result.classList.toggle('selected', result === selected));
}

async function search() {
  const query = $('search-query').value.trim(); if (!query) return;
  expandStep('search-card', 'search-summary');
  try {
    setStatus('Searching…'); $('search-button').disabled = true;
    const { bggToken } = await credentials();
    const games = await searchGames(query, $('search-year').value.trim(), bggToken);
    const nodes = games.map(game => {
      const details = element('span', {}, element('strong', { text: game.name }), element('small', { text: `${game.year || 'Year unknown'} · BGG #${game.id}` }));
      const image = game.thumbnail ? element('img', { attrs: { src: game.thumbnail, alt: '' } }) : null;
      const button = element('button', { className: 'result' }, image, details);
      button.addEventListener('click', () => chooseGame(game, button)); return button;
    });
    setChildren($('search-results'), ...(nodes.length ? nodes : [element('p', { className: 'muted', text: 'No matching games.' })]));
    setStatus('Ready', 'success');
  } catch (error) { setStatus('Search failed', 'error'); toast(errorMessage(error)); }
  finally { $('search-button').disabled = false; }
}

async function chooseGame(game, button) {
  state.game = game; state.forum = null; state.threadMeta = []; state.prepared = [];
  selectResult($('search-results'), button);
  collapseStep('search-card', 'search-summary', `${game.name}${game.year ? ` (${game.year})` : ''}`);
  expandStep('forum-card', 'forum-summary'); show('forum-card'); show('options-card', false); resetScrapeSurfaces();
  setChildren($('forum-results'), element('p', { className: 'muted', text: 'Loading forums…' }));
  try {
    const { bggToken } = await credentials(); const forums = await getForums(game.id, bggToken);
    const nodes = forums.map(forum => {
      const buttonNode = element('button', { className: 'result' }, element('span', {}, element('strong', { text: forum.title }), element('small', { text: `${forum.numThreads} threads` })));
      buttonNode.addEventListener('click', () => chooseForum(forum, buttonNode)); return buttonNode;
    });
    setChildren($('forum-results'), ...nodes);
  } catch (error) { setChildren($('forum-results'), element('p', { className: 'notice error', text: errorMessage(error) })); }
}

function chooseForum(forum, button) {
  state.forum = forum; state.threadMeta = []; state.prepared = [];
  selectResult($('forum-results'), button);
  collapseStep('forum-card', 'forum-summary', `${forum.title} · ${forum.numThreads} threads`);
  show('options-card'); $('scrape-button').disabled = true; resetScrapeSurfaces();
  $('scrape-estimate').textContent = `${forum.numThreads} threads reported. Select Preview scrape to apply filters.`;
  reveal('options-card');
}

function currentFilters() {
  return {
    maxThreads: Number($('max-threads').value) || null, dateFrom: $('date-from').value || '',
    subject: $('subject-filter').value.trim(), answeredOnly: $('answered-only').checked,
    authors: $('designer-only').checked ? uniqueCsv($('author-filter').value) : []
  };
}

function applyFilters(items, filters) {
  let result = [...items];
  if (filters.dateFrom) {
    const from = new Date(`${filters.dateFrom}T00:00:00`);
    result = result.filter(item => { const date = safeDate(item.lastPostDate); return !date || date >= from; });
  }
  if (filters.subject) { const query = filters.subject.toLowerCase(); result = result.filter(item => item.subject.toLowerCase().includes(query)); }
  if (filters.answeredOnly) result = result.filter(item => item.numArticles > 1);
  if (filters.maxThreads) result = result.slice(0, filters.maxThreads);
  return result;
}

async function prepareScrape() {
  if (!state.forum) return;
  try {
    setStatus('Loading forum…'); $('prepare-button').disabled = true; $('scrape-button').disabled = true; resetScrapeSurfaces();
    const { bggToken } = await credentials();
    state.threadMeta = await getForumThreads(state.forum.id, bggToken, count => { $('scrape-estimate').textContent = `Loaded ${count} thread summaries…`; });
    const filters = currentFilters(); let prepared = applyFilters(state.threadMeta, filters);
    const id = `${state.game.id}-${state.forum.id}`; const saved = await datasets.get(id);
    if ($('scrape-mode').value === 'update' && saved) {
      const existing = new Set(saved.threads.map(thread => thread.id)); prepared = prepared.filter(thread => !existing.has(thread.id));
    }
    state.prepared = prepared;
    const estimate = formatDuration(prepared.length * 1.5);
    $('scrape-estimate').textContent = `${prepared.length} of ${state.threadMeta.length} threads will be requested · ${estimate}. Progress is checkpointed after each thread.`;
    $('scrape-button').disabled = prepared.length === 0;
    setStatus('Preview ready', 'success');
  } catch (error) { setStatus('Preview failed', 'error'); toast(errorMessage(error)); }
  finally { $('prepare-button').disabled = false; }
}

function confirmScrape() {
  setChildren($('confirm-details'),
    element('p', { text: `${state.game.name} — ${state.forum.title}` }),
    element('p', { text: `${state.prepared.length} threads will be fetched. Existing progress will be preserved if the operation is interrupted.` })
  );
  $('confirm-dialog').showModal();
}

function resetScrapeSurfaces() {
  show('scrape-progress', false); show('scrape-details', false); show('scrape-result', false); show('scrape-next', false);
}

function updateScrapeProgress(index, total, subject, startedAt) {
  bar('scrape-bar', index, total);
  $('scrape-counter').textContent = `${index + 1} / ${total} threads`;
  $('scrape-current').textContent = subject;
  const elapsed = (Date.now() - startedAt) / 1000;
  $('scrape-eta').textContent = index > 0 ? `${formatDuration(elapsed / index * (total - index))} remaining` : 'estimating…';
}

/** Shows what a finished, cancelled, or failed scrape produced and what to do next. */
function finishScrape(dataset, outcome, message) {
  show('scrape-progress', false);
  const posts = dataset.threads.reduce((sum, thread) => sum + thread.posts.length, 0);
  const failures = dataset.scrape.failures?.length || 0;
  const detail = [`${dataset.threads.length} threads`, `${posts} posts`, failures ? `${failures} failed` : null]
    .filter(Boolean).join(' · ');
  notice('scrape-result', outcome === 'complete' ? 'success' : 'error',
    summaryBlock(outcome === 'complete' ? 'Scrape complete' : 'Scrape stopped', detail),
    message ? element('p', { className: 'muted', text: message }) : null,
    element('p', { className: 'muted', text: outcome === 'complete'
      ? 'The dataset is saved locally. Generate a FAQ from it, or come back to it any time from the Library.'
      : 'Everything fetched so far is saved. Retrying picks up only the threads that are still missing.' })
  );
  show('scrape-next'); show('next-retry', outcome !== 'complete' || failures > 0);
  $('next-generate').onclick = () => { state.activeDataset = dataset; state.faqError = ''; activateTab('faq'); };
  $('next-library').onclick = () => activateTab('library');
  $('next-retry').onclick = async () => { loadDatasetForUpdate(dataset); await prepareScrape(); };
}

async function startScrape() {
  $('confirm-dialog').close(); const id = `${state.game.id}-${state.forum.id}`;
  let dataset = null;
  try {
    const { bggToken } = await credentials(); const filters = currentFilters();
    const previous = $('scrape-mode').value === 'update' ? await datasets.get(id) : null;
    const existingThreads = previous?.threads || [];
    dataset = {
      id, schemaVersion: 2, game: state.game, forum: state.forum,
      threads: [...existingThreads], faq: previous?.faq || null, generation: previous?.generation || null,
      updatedAt: new Date().toISOString(),
      scrape: { status: 'running', startedAt: new Date().toISOString(), completedAt: null, filters, pendingIds: state.prepared.map(item => item.id), failures: [] }
    };
    await datasets.put(dataset); state.activeDataset = dataset; state.scrapeController = new AbortController();
    state.logLines = []; $('scrape-log').textContent = '';
    resetScrapeSurfaces(); show('scrape-progress'); show('scrape-details'); $('scrape-details').open = false;
    show('cancel-scrape'); $('scrape-button').disabled = true; $('prepare-button').disabled = true;
    setStatus('Scraping…');
    const authors = new Set(filters.authors); const total = state.prepared.length; const startedAt = Date.now();
    for (let index = 0; index < total; index++) {
      if (state.scrapeController.signal.aborted) throw new Error('Scrape cancelled.');
      const meta = state.prepared[index];
      updateScrapeProgress(index, total, meta.subject, startedAt);
      log(`${index + 1}/${total}: ${meta.subject}`);
      try {
        const thread = await getThread(meta, bggToken, state.scrapeController.signal);
        if (authors.size) thread.posts = thread.posts.filter(post => authors.has(post.author.toLowerCase()));
        if (thread.posts.length) dataset.threads.push(thread); else log(`Skipped ${meta.id}: no matching posts.`);
      } catch (error) {
        if (state.scrapeController.signal.aborted) throw error;
        log(`Failed ${meta.id}: ${errorMessage(error)}`);
        dataset.scrape.failures.push({ id: meta.id, message: errorMessage(error) });
      }
      dataset.scrape.pendingIds = state.prepared.slice(index + 1).map(item => item.id); dataset.updatedAt = new Date().toISOString();
      await datasets.put(dataset);
      await new Promise(resolve => setTimeout(resolve, 700));
    }
    dataset.scrape.status = 'complete'; dataset.scrape.completedAt = new Date().toISOString(); dataset.updatedAt = dataset.scrape.completedAt;
    await datasets.put(dataset); bar('scrape-bar', total, total); log(`Complete: ${dataset.threads.length} stored threads.`);
    setStatus('Scrape complete', 'success'); state.activeDataset = dataset;
    finishScrape(dataset, 'complete'); renderFaqSource(); await renderLibrary();
  } catch (error) {
    if (dataset) { dataset.scrape.status = 'interrupted'; dataset.updatedAt = new Date().toISOString(); await datasets.put(dataset); }
    setStatus('Scrape stopped', 'error'); log(errorMessage(error));
    if (dataset) finishScrape(dataset, 'interrupted', errorMessage(error));
    await renderLibrary();
  } finally {
    state.scrapeController = null; show('cancel-scrape', false); $('prepare-button').disabled = false; $('scrape-button').disabled = state.prepared.length === 0;
  }
}

function selectedProvider() { return $('provider-select').value; }

function populateModels(preferred = '') {
  const provider = selectedProvider();
  const select = $('model-select');
  setChildren(select,
    ...modelsFor(provider).map(model => element('option', { text: `${model.label} · $${model.inputUsd}/$${model.outputUsd} per Mtok`, attrs: { value: model.id } })),
    element('option', { text: 'Custom model ID', attrs: { value: 'custom' } })
  );
  select.value = preferred || DEFAULT_MODELS[provider];
  if (!select.value) select.value = 'custom';
  $('custom-model').placeholder = providerInfo(provider).modelHint;
  show('custom-model-wrap', select.value === 'custom');
  $('ai-consent-text').textContent = `I understand that forum content will be sent to ${providerInfo(provider).name} for inference, may incur charges, and must be used consistently with BGG’s terms.`;
}

function selectedModel() { return $('model-select').value === 'custom' ? $('custom-model').value.trim() : $('model-select').value; }

/** Saved partial work is only reusable if the same model would rebuild the same chunks. */
function resumableParts(dataset, provider, model) {
  const saved = dataset?.generation;
  const savedProvider = saved?.provider || 'anthropic';
  if (!saved?.parts?.length || !model || saved.model !== model || savedProvider !== provider) return null;
  const plan = generationPlan(dataset, model, provider);
  if (saved.chunkTotal !== plan.chunkTotal || saved.parts.length >= plan.chunkTotal) return null;
  return { parts: saved.parts, chunkTotal: plan.chunkTotal, focus: saved.focus || '' };
}

function renderFaqSource() {
  const dataset = state.activeDataset;
  const busy = Boolean(state.faqController);
  show('faq-output-wrap', false); show('faq-downloads', false); show('faq-resume-row', false);
  if (!busy) { show('faq-progress-wrap', false); show('faq-result', false); }
  if (!dataset) {
    $('faq-source').textContent = 'Choose a dataset from the Library or finish a scrape.'; $('generate-button').disabled = true;
    $('cost-estimate').textContent = 'Select a dataset to estimate request size.'; return;
  }
  const posts = dataset.threads.reduce((sum, thread) => sum + thread.posts.length, 0);
  $('faq-source').textContent = `${dataset.game.name} · ${dataset.forum.title} · ${dataset.threads.length} threads / ${posts} posts`;

  const model = selectedModel();
  const provider = selectedProvider();
  const estimate = estimateGeneration(dataset.threads, model);
  $('cost-estimate').textContent = `${estimate.requests} request(s) · about ${estimate.inputTokens.toLocaleString()} input and ${estimate.outputTokens.toLocaleString()} output tokens` +
    (estimate.estimatedUsd === null
      ? '. Cost unknown for a custom model ID.'
      : ` · roughly US$${estimate.estimatedUsd.toFixed(2)}. The actual cost is shown after generation.`);
  $('generate-button').disabled = busy || !$('ai-consent').checked || !dataset.threads.length;

  if (busy) return;

  const resumable = resumableParts(dataset, provider, model);
  if (resumable) {
    notice('faq-result', 'error',
      summaryBlock('Unfinished generation', `${resumable.parts.length} of ${resumable.chunkTotal} source groups already analyzed`),
      element('p', { className: 'muted', text: 'Those requests are already paid for and saved. Resuming continues from the next group; discarding starts over at full cost.' })
    );
    show('faq-resume-row');
    $('generate-button').disabled = true;
    return;
  }
  if (state.faqError) {
    notice('faq-result', 'error',
      summaryBlock('Generation failed', state.faqError),
      element('p', { className: 'muted', text: 'Nothing was charged for a request that never completed. Check the API key and model in Settings, then generate again.' })
    );
    return;
  }
  if (dataset.faq?.text) {
    $('faq-output').textContent = dataset.faq.text;
    show('faq-output-wrap'); show('faq-downloads');
    const cost = usageCost(dataset.faq.model, dataset.faq.usage, dataset.faq.provider || 'anthropic');
    notice('faq-result', 'success',
      summaryBlock('FAQ ready', `${dataset.faq.model} · ${new Date(dataset.faq.generatedAt).toLocaleString()}` + (cost === null ? '' : ` · US$${cost.toFixed(2)} actual`)),
      element('p', { className: 'muted', text: 'Download it below, then verify the answers against the linked threads and the official rulebook. Generating again replaces this FAQ.' })
    );
  }
}

async function runGeneration({ resume }) {
  const dataset = state.activeDataset;
  try {
    const provider = selectedProvider();
    const values = await credentials(provider); const model = selectedModel();
    const apiKey = values[providerInfo(provider).keyField];
    if (!model) throw new Error('Enter a model ID.');
    if (!$('ai-consent').checked) throw new Error('Confirm the AI data-transfer notice first.');
    state.faqError = '';
    const saved = resume ? resumableParts(dataset, provider, model) : null;
    if (resume && !saved) throw new Error('The saved parts no longer match this dataset and model.');
    const focus = resume ? saved.focus : $('faq-focus').value.trim();
    if (resume) $('faq-focus').value = focus;

    state.faqController = new AbortController();
    show('cancel-faq'); show('faq-resume-row', false); show('faq-result', false);
    show('faq-output-wrap', false); show('faq-downloads', false); show('faq-progress-wrap');
    $('generate-button').disabled = true;

    const faq = await generateFaq({
      dataset, provider, apiKey, model, focus, signal: state.faqController.signal,
      startParts: saved?.parts || [],
      onProgress: (current, total, text) => {
        bar('faq-progress', current, total);
        $('faq-counter').textContent = `${current} / ${total} requests`;
        $('faq-stage').textContent = text; setStatus(text);
      },
      onPart: async (parts, meta) => {
        dataset.generation = { ...meta, parts, updatedAt: new Date().toISOString() };
        await datasets.put(dataset);
      }
    });
    dataset.faq = faq; dataset.generation = null; dataset.updatedAt = new Date().toISOString();
    await datasets.put(dataset);
    setStatus('FAQ ready', 'success');
  } catch (error) {
    setStatus('FAQ failed', 'error'); toast(errorMessage(error));
    // A resumable run explains itself through the resume panel; anything else
    // needs the error kept on screen rather than only in a four-second toast.
    state.faqError = resumableParts(dataset, selectedProvider(), selectedModel()) ? '' : errorMessage(error);
  } finally {
    state.faqController = null; show('cancel-faq', false); show('faq-progress-wrap', false);
    renderFaqSource(); await renderLibrary();
  }
}

function libraryItem(dataset) {
  const posts = dataset.threads.reduce((sum, thread) => sum + thread.posts.length, 0);
  const pending = dataset.generation?.parts?.length;
  const container = element('article', { className: 'library-item' },
    element('h3', { text: `${dataset.game.name} — ${dataset.forum.title}` }),
    element('p', { text: `${dataset.threads.length} threads · ${posts} posts · ${new Date(dataset.updatedAt).toLocaleString()} · ${dataset.scrape.status}` +
      (dataset.faq?.text ? ' · has FAQ' : '') + (pending ? ` · ${pending} unfinished FAQ part(s)` : '') })
  );
  const actions = element('div', { className: 'button-row' });
  const use = element('button', { className: 'primary', text: dataset.faq?.text ? 'Open FAQ' : 'Generate FAQ' });
  use.addEventListener('click', () => { state.activeDataset = dataset; state.faqError = ''; activateTab('faq'); });
  const update = element('button', { className: 'secondary', text: 'Scrape new threads' }); update.addEventListener('click', () => loadDatasetForUpdate(dataset));
  const txt = element('button', { className: 'secondary', text: 'TXT' }); txt.addEventListener('click', () => download(datasetText(dataset), filenames(dataset).txt, 'text/plain'));
  const json = element('button', { className: 'secondary', text: 'JSON' }); json.addEventListener('click', () => download(datasetJson(dataset), filenames(dataset).json, 'application/json'));
  const remove = element('button', { className: 'danger', text: 'Delete' }); remove.addEventListener('click', async () => {
    if (!confirm(`Delete the complete saved dataset for ${dataset.game.name}?`)) return;
    await datasets.delete(dataset.id); if (state.activeDataset?.id === dataset.id) { state.activeDataset = null; renderFaqSource(); }
    renderLibrary();
  });
  actions.append(use, update, txt, json); if (dataset.faq?.text) {
    const md = element('button', { className: 'secondary', text: 'FAQ .md' }); md.addEventListener('click', () => download(faqMarkdown(dataset), filenames(dataset).md, 'text/markdown')); actions.append(md);
  }
  actions.append(remove); container.append(actions); return container;
}

function loadDatasetForUpdate(dataset) {
  state.activeDataset = dataset; state.game = dataset.game; state.forum = dataset.forum; state.threadMeta = []; state.prepared = [];
  $('search-query').value = dataset.game.name; $('scrape-mode').value = 'update';
  collapseStep('search-card', 'search-summary', dataset.game.name);
  collapseStep('forum-card', 'forum-summary', `${dataset.forum.title} · saved dataset`);
  show('forum-card'); show('options-card'); $('scrape-button').disabled = true; resetScrapeSurfaces();
  $('scrape-estimate').textContent = `${dataset.threads.length} saved threads. Select Preview scrape to find missing threads.`;
  activateTab('scrape'); reveal('options-card');
}

async function renderLibrary() {
  const all = (await datasets.all()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  setChildren($('library-list'), ...(all.length ? all.map(libraryItem) : [element('p', { className: 'muted', text: 'No saved datasets.' })]));
}

async function readFile(input) { const file = input.files?.[0]; if (!file) return null; const text = await file.text(); input.value = ''; return text; }

function bindEvents() {
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));
  $('search-button').addEventListener('click', search); $('search-query').addEventListener('keydown', event => { if (event.key === 'Enter') search(); });
  $('edit-search').addEventListener('click', () => expandStep('search-card', 'search-summary'));
  $('edit-forum').addEventListener('click', () => expandStep('forum-card', 'forum-summary'));
  $('prepare-button').addEventListener('click', prepareScrape); $('scrape-button').addEventListener('click', confirmScrape);
  $('confirm-cancel').addEventListener('click', () => $('confirm-dialog').close()); $('confirm-start').addEventListener('click', startScrape);
  $('cancel-scrape').addEventListener('click', () => state.scrapeController?.abort());
  $('designer-only').addEventListener('change', () => show('authors-wrap', $('designer-only').checked));
  $('ai-consent').addEventListener('change', renderFaqSource);
  $('provider-select').addEventListener('change', () => { $('ai-consent').checked = false; populateModels(); renderFaqSource(); });
  $('model-select').addEventListener('change', () => { show('custom-model-wrap', $('model-select').value === 'custom'); renderFaqSource(); });
  $('custom-model').addEventListener('input', renderFaqSource);
  $('generate-button').addEventListener('click', () => runGeneration({ resume: false }));
  $('resume-button').addEventListener('click', () => runGeneration({ resume: true }));
  $('discard-parts').addEventListener('click', async () => {
    if (!state.activeDataset || !confirm('Discard the saved parts? Regenerating will pay for those requests again.')) return;
    state.activeDataset.generation = null; await datasets.put(state.activeDataset); renderFaqSource(); await renderLibrary();
  });
  $('cancel-faq').addEventListener('click', () => state.faqController?.abort());
  $('download-md').addEventListener('click', () => download(faqMarkdown(state.activeDataset), filenames(state.activeDataset).md, 'text/markdown'));
  $('download-html').addEventListener('click', () => download(faqHtml(state.activeDataset), filenames(state.activeDataset).html, 'text/html'));
  $('faq-import').addEventListener('change', async event => { try { const text = await readFile(event.target); if (!text) return; const dataset = importFaqMarkdown(text); await datasets.put(dataset); state.activeDataset = dataset; renderFaqSource(); await renderLibrary(); toast('FAQ and its source dataset were restored.'); } catch (error) { toast(errorMessage(error)); } });
  $('refresh-library').addEventListener('click', renderLibrary);
  $('export-library').addEventListener('click', async () => { const backup = await exportBackup(); download(JSON.stringify(backup, null, 2), `bgg-faq-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json'); });
  $('import-library').addEventListener('change', async event => { try { const text = await readFile(event.target); if (!text) return; const count = await importBackup(JSON.parse(text)); await renderLibrary(); toast(`Restored ${count} dataset(s).`); } catch (error) { toast(errorMessage(error)); } });
  $('save-settings').addEventListener('click', async () => { await saveCredentials({ bggToken: $('bgg-token').value.trim(), anthropicKey: $('anthropic-key').value.trim(), openaiKey: $('openai-key').value.trim(), geminiKey: $('gemini-key').value.trim(), remember: $('remember-credentials').checked }); toast('Credentials saved.'); });
  $('clear-settings').addEventListener('click', async () => { await clearCredentials(); $('bgg-token').value = ''; $('anthropic-key').value = ''; $('openai-key').value = ''; $('gemini-key').value = ''; $('remember-credentials').checked = false; toast('Credentials cleared.'); });
}

async function init() {
  setChildren($('provider-select'), ...PROVIDERS.map(provider => element('option', { text: provider.label, attrs: { value: provider.id } })));
  $('provider-select').value = DEFAULT_PROVIDER; populateModels(); bindEvents();
  const saved = await loadCredentials(); $('bgg-token').value = saved.bggToken; $('anthropic-key').value = saved.anthropicKey; $('openai-key').value = saved.openaiKey; $('gemini-key').value = saved.geminiKey; $('remember-credentials').checked = saved.remember;
  const all = await datasets.all(); state.activeDataset = all.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
  renderFaqSource(); renderLibrary(); setStatus('Ready', 'success');
}

init().catch(error => { setStatus('Startup failed', 'error'); toast(errorMessage(error)); });
