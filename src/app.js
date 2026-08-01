import { searchGames, getForums, getForumThreads, getThread } from './bgg-api.js';
import { datasets, loadCredentials, saveCredentials, clearCredentials, exportBackup, importBackup } from './storage.js';
import { estimateGeneration, generateFaq } from './anthropic-api.js';
import { faqMarkdown, faqHtml, importFaqMarkdown, datasetJson, datasetText, filenames } from './exports.js';
import { download, element, formatBytes, formatDuration, safeDate, setChildren, uniqueCsv } from './utils.js';

const $ = id => document.getElementById(id);
const state = { game: null, forum: null, threadMeta: [], prepared: [], activeDataset: null, scrapeController: null, faqController: null };

function setStatus(text, type = 'neutral') { $('global-status').textContent = text; $('global-status').className = `status ${type}`; }
function show(id, visible = true) { $(id).classList.toggle('hidden', !visible); }
function progress(id, current, total) { show(id); $(id).firstElementChild.style.width = `${total ? Math.min(100, current / total * 100) : 0}%`; }
function toast(message) { $('toast').textContent = message; show('toast'); setTimeout(() => show('toast', false), 4000); }
function log(message) { show('scrape-log'); $('scrape-log').textContent += `[${new Date().toLocaleTimeString()}] ${message}\n`; $('scrape-log').scrollTop = $('scrape-log').scrollHeight; }
function errorMessage(error) { return error?.message || String(error); }

function activateTab(name) {
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
  if (name === 'library') renderLibrary();
  if (name === 'faq') renderFaqSource();
}

async function credentials(requireAnthropic = false) {
  const values = await loadCredentials();
  if (!values.bggToken) { activateTab('settings'); throw new Error('Add a BGG application token in Settings.'); }
  if (requireAnthropic && !values.anthropicKey) { activateTab('settings'); throw new Error('Add an Anthropic API key in Settings.'); }
  return values;
}

function selectResult(container, selected) {
  container.querySelectorAll('.result').forEach(result => result.classList.toggle('selected', result === selected));
}

async function search() {
  const query = $('search-query').value.trim(); if (!query) return;
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
  selectResult($('search-results'), button); show('forum-card'); show('options-card', false);
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
  selectResult($('forum-results'), button); show('options-card'); $('scrape-button').disabled = true;
  $('scrape-estimate').textContent = `${forum.numThreads} threads reported. Select Preview scrape to apply filters.`;
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
    setStatus('Loading forum…'); $('prepare-button').disabled = true; $('scrape-button').disabled = true;
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

async function startScrape() {
  $('confirm-dialog').close(); const id = `${state.game.id}-${state.forum.id}`;
  try {
    const { bggToken } = await credentials(); const filters = currentFilters();
    const previous = $('scrape-mode').value === 'update' ? await datasets.get(id) : null;
    const existingThreads = previous?.threads || [];
    const dataset = {
      id, schemaVersion: 2, game: state.game, forum: state.forum,
      threads: [...existingThreads], faq: previous?.faq || null, updatedAt: new Date().toISOString(),
      scrape: { status: 'running', startedAt: new Date().toISOString(), completedAt: null, filters, pendingIds: state.prepared.map(item => item.id) }
    };
    await datasets.put(dataset); state.activeDataset = dataset; state.scrapeController = new AbortController();
    $('scrape-log').textContent = ''; show('cancel-scrape'); $('scrape-button').disabled = true; $('prepare-button').disabled = true;
    const authors = new Set(filters.authors); const total = state.prepared.length;
    for (let index = 0; index < total; index++) {
      if (state.scrapeController.signal.aborted) throw new Error('Scrape cancelled.');
      const meta = state.prepared[index]; progress('scrape-progress', index, total); log(`${index + 1}/${total}: ${meta.subject}`);
      try {
        const thread = await getThread(meta, bggToken, state.scrapeController.signal);
        if (authors.size) thread.posts = thread.posts.filter(post => authors.has(post.author.toLowerCase()));
        if (thread.posts.length) dataset.threads.push(thread); else log(`Skipped ${meta.id}: no matching posts.`);
      } catch (error) {
        if (state.scrapeController.signal.aborted) throw error;
        log(`Failed ${meta.id}: ${errorMessage(error)}`);
        dataset.scrape.failures ||= []; dataset.scrape.failures.push({ id: meta.id, message: errorMessage(error) });
      }
      dataset.scrape.pendingIds = state.prepared.slice(index + 1).map(item => item.id); dataset.updatedAt = new Date().toISOString();
      await datasets.put(dataset);
      await new Promise(resolve => setTimeout(resolve, 700));
    }
    dataset.scrape.status = 'complete'; dataset.scrape.completedAt = new Date().toISOString(); dataset.updatedAt = dataset.scrape.completedAt;
    await datasets.put(dataset); progress('scrape-progress', total, total); log(`Complete: ${dataset.threads.length} stored threads.`);
    setStatus('Scrape complete', 'success'); state.activeDataset = dataset; renderFaqSource(); await renderLibrary();
  } catch (error) {
    if (state.activeDataset) { state.activeDataset.scrape.status = 'interrupted'; state.activeDataset.updatedAt = new Date().toISOString(); await datasets.put(state.activeDataset); }
    setStatus('Scrape stopped', 'error'); log(errorMessage(error));
  } finally {
    state.scrapeController = null; show('cancel-scrape', false); $('prepare-button').disabled = false; $('scrape-button').disabled = state.prepared.length === 0;
  }
}

function renderFaqSource() {
  const dataset = state.activeDataset;
  if (!dataset) {
    $('faq-source').textContent = 'Choose a dataset from the Library or finish a scrape.'; $('generate-button').disabled = true;
    $('cost-estimate').textContent = 'Select a dataset to estimate request size.'; return;
  }
  const posts = dataset.threads.reduce((sum, thread) => sum + thread.posts.length, 0);
  $('faq-source').textContent = `${dataset.game.name} · ${dataset.forum.title} · ${dataset.threads.length} threads / ${posts} posts`;
  const model = selectedModel(); const estimate = estimateGeneration(dataset.threads, model);
  $('cost-estimate').textContent = `${estimate.chunks} request group(s) · approximately ${estimate.inputTokens.toLocaleString()} input tokens and up to ${estimate.outputTokens.toLocaleString()} output tokens` +
    (estimate.estimatedUsd === null ? '. Cost unavailable for custom model.' : ` · conservative ceiling about US$${estimate.estimatedUsd.toFixed(2)}.`);
  $('generate-button').disabled = !$('ai-consent').checked || !dataset.threads.length;
  if (dataset.faq?.text) { $('faq-output').textContent = dataset.faq.text; show('faq-output'); show('faq-downloads'); }
}

function selectedModel() { return $('model-select').value === 'custom' ? $('custom-model').value.trim() : $('model-select').value; }

async function generate() {
  try {
    const { anthropicKey } = await credentials(true); const model = selectedModel();
    if (!model) throw new Error('Enter a model ID.'); if (!$('ai-consent').checked) throw new Error('Confirm the AI data-transfer notice first.');
    state.faqController = new AbortController(); show('cancel-faq'); $('generate-button').disabled = true; show('faq-output', false); show('faq-downloads', false);
    const faq = await generateFaq({ dataset: state.activeDataset, apiKey: anthropicKey, model, focus: $('faq-focus').value.trim(), signal: state.faqController.signal,
      onProgress: (current, total, text) => { progress('faq-progress', current, total); setStatus(text); } });
    state.activeDataset.faq = faq; state.activeDataset.updatedAt = new Date().toISOString(); await datasets.put(state.activeDataset);
    $('faq-output').textContent = faq.text; show('faq-output'); show('faq-downloads'); setStatus('FAQ ready', 'success');
  } catch (error) { setStatus('FAQ failed', 'error'); toast(errorMessage(error)); }
  finally { state.faqController = null; show('cancel-faq', false); renderFaqSource(); }
}

function libraryItem(dataset) {
  const posts = dataset.threads.reduce((sum, thread) => sum + thread.posts.length, 0);
  const container = element('article', { className: 'library-item' },
    element('h3', { text: `${dataset.game.name} — ${dataset.forum.title}` }),
    element('p', { text: `${dataset.threads.length} threads · ${posts} posts · ${new Date(dataset.updatedAt).toLocaleString()} · ${dataset.scrape.status}` })
  );
  const actions = element('div', { className: 'button-row' });
  const use = element('button', { className: 'primary', text: 'Use' }); use.addEventListener('click', () => { state.activeDataset = dataset; activateTab('faq'); });
  const update = element('button', { className: 'secondary', text: 'Update' }); update.addEventListener('click', () => loadDatasetForUpdate(dataset));
  const txt = element('button', { className: 'secondary', text: 'TXT' }); txt.addEventListener('click', () => download(datasetText(dataset), filenames(dataset).txt, 'text/plain'));
  const json = element('button', { className: 'secondary', text: 'JSON' }); json.addEventListener('click', () => download(datasetJson(dataset), filenames(dataset).json, 'application/json'));
  const remove = element('button', { className: 'danger', text: 'Delete' }); remove.addEventListener('click', async () => {
    if (!confirm(`Delete the complete saved dataset for ${dataset.game.name}?`)) return;
    await datasets.delete(dataset.id); if (state.activeDataset?.id === dataset.id) state.activeDataset = null; renderLibrary();
  });
  actions.append(use, update, txt, json); if (dataset.faq?.text) {
    const md = element('button', { className: 'secondary', text: 'FAQ' }); md.addEventListener('click', () => download(faqMarkdown(dataset), filenames(dataset).md, 'text/markdown')); actions.append(md);
  }
  actions.append(remove); container.append(actions); return container;
}

function loadDatasetForUpdate(dataset) {
  state.activeDataset = dataset; state.game = dataset.game; state.forum = dataset.forum; state.threadMeta = []; state.prepared = [];
  $('search-query').value = dataset.game.name; $('scrape-mode').value = 'update';
  show('forum-card', false); show('options-card'); $('scrape-button').disabled = true;
  $('scrape-estimate').textContent = `${dataset.threads.length} saved threads. Select Preview scrape to find missing threads.`;
  activateTab('scrape');
}

async function renderLibrary() {
  const all = (await datasets.all()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  setChildren($('library-list'), ...(all.length ? all.map(libraryItem) : [element('p', { className: 'muted', text: 'No saved datasets.' })]));
}

async function readFile(input) { const file = input.files?.[0]; if (!file) return null; const text = await file.text(); input.value = ''; return text; }

function bindEvents() {
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));
  $('search-button').addEventListener('click', search); $('search-query').addEventListener('keydown', event => { if (event.key === 'Enter') search(); });
  $('prepare-button').addEventListener('click', prepareScrape); $('scrape-button').addEventListener('click', confirmScrape);
  $('confirm-cancel').addEventListener('click', () => $('confirm-dialog').close()); $('confirm-start').addEventListener('click', startScrape);
  $('cancel-scrape').addEventListener('click', () => state.scrapeController?.abort());
  $('designer-only').addEventListener('change', () => show('authors-wrap', $('designer-only').checked));
  $('ai-consent').addEventListener('change', renderFaqSource); $('model-select').addEventListener('change', () => { show('custom-model-wrap', $('model-select').value === 'custom'); renderFaqSource(); });
  $('custom-model').addEventListener('input', renderFaqSource); $('generate-button').addEventListener('click', generate); $('cancel-faq').addEventListener('click', () => state.faqController?.abort());
  $('download-md').addEventListener('click', () => download(faqMarkdown(state.activeDataset), filenames(state.activeDataset).md, 'text/markdown'));
  $('download-html').addEventListener('click', () => download(faqHtml(state.activeDataset), filenames(state.activeDataset).html, 'text/html'));
  $('faq-import').addEventListener('change', async event => { try { const text = await readFile(event.target); if (!text) return; const dataset = importFaqMarkdown(text); await datasets.put(dataset); state.activeDataset = dataset; renderFaqSource(); toast('FAQ and source dataset imported.'); } catch (error) { toast(errorMessage(error)); } });
  $('refresh-library').addEventListener('click', renderLibrary);
  $('export-library').addEventListener('click', async () => { const backup = await exportBackup(); download(JSON.stringify(backup, null, 2), `bgg-faq-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json'); });
  $('import-library').addEventListener('change', async event => { try { const text = await readFile(event.target); if (!text) return; const count = await importBackup(JSON.parse(text)); await renderLibrary(); toast(`Restored ${count} dataset(s).`); } catch (error) { toast(errorMessage(error)); } });
  $('save-settings').addEventListener('click', async () => { await saveCredentials({ bggToken: $('bgg-token').value.trim(), anthropicKey: $('anthropic-key').value.trim(), remember: $('remember-credentials').checked }); toast('Credentials saved.'); });
  $('clear-settings').addEventListener('click', async () => { await clearCredentials(); $('bgg-token').value = ''; $('anthropic-key').value = ''; $('remember-credentials').checked = false; toast('Credentials cleared.'); });
}

async function init() {
  bindEvents(); const saved = await loadCredentials(); $('bgg-token').value = saved.bggToken; $('anthropic-key').value = saved.anthropicKey; $('remember-credentials').checked = saved.remember;
  const all = await datasets.all(); state.activeDataset = all.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
  renderFaqSource(); renderLibrary(); setStatus('Ready', 'success');
}

init().catch(error => { setStatus('Startup failed', 'error'); toast(errorMessage(error)); });
