'use strict';

const state = {
  game: null, forum: null, threads: [],
  lastScrapeDate: null, faqText: '', mode: 'full'
};

const BGG    = 'https://boardgamegeek.com/xmlapi2';
const CLAUDE = 'https://api.anthropic.com/v1/messages';
const SLEEP  = ms => new Promise(r => setTimeout(r, ms));

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  renderSaved();
  bindEvents();
});

function bindEvents() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => showTab(tab.dataset.tab, tab));
  });
  document.getElementById('btn-save-config').addEventListener('click', saveConfig);
  document.getElementById('vis-bgg').addEventListener('click', () => toggleVis('bgg-token', document.getElementById('vis-bgg')));
  document.getElementById('vis-claude').addEventListener('click', () => toggleVis('claude-key', document.getElementById('vis-claude')));
  document.getElementById('btn-search').addEventListener('click', searchGame);
  document.getElementById('search-q').addEventListener('keydown', e => { if (e.key === 'Enter') searchGame(); });
  document.getElementById('search-year').addEventListener('keydown', e => { if (e.key === 'Enter') searchGame(); });
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  document.getElementById('btn-scrape').addEventListener('click', startScrape);
  document.getElementById('btn-dl-txt').addEventListener('click', downloadTxt);
  document.getElementById('btn-dl-json').addEventListener('click', downloadJSON);
  document.getElementById('done-dl-txt').addEventListener('click', downloadTxt);
  document.getElementById('done-dl-json').addEventListener('click', downloadJSON);
  document.getElementById('done-go-faq').addEventListener('click', () => {
    showTab('faq', document.querySelector('.tab[data-tab="faq"]'));
  });
  document.getElementById('btn-gen-faq').addEventListener('click', generateFAQ);
  document.getElementById('btn-dl-faq').addEventListener('click', downloadFAQ);
  document.getElementById('faq-upload-input').addEventListener('change', function() { loadFAQFile(this); });
}

function showTab(name, clickedEl) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (clickedEl) clickedEl.classList.add('active');
  if (name === 'saved') renderSaved();
  if (name === 'faq') {
    updateFAQSourceInfo();
    const err = document.getElementById('faq-error');
    if (err) err.remove();
  } else {
    // Leaving FAQ tab — clear preview and progress so it's clean on return
    document.getElementById('faq-preview').classList.add('hidden');
    document.getElementById('faq-preview').textContent = '';
    document.getElementById('faq-progress-wrap').classList.add('hidden');
    document.getElementById('faq-progress-text').textContent = '';
    document.getElementById('faq-progress-fill').style.width = '0%';
    document.getElementById('btn-dl-faq').disabled = true;
    const err = document.getElementById('faq-error');
    if (err) err.remove();
    // Keep state.faqText so re-entering FAQ tab can regenerate if needed
    state.faqText = '';
  }
}

function saveConfig() {
  const t = document.getElementById('bgg-token').value.trim();
  const k = document.getElementById('claude-key').value.trim();
  chrome.storage.local.set({ bgg_token: t, claude_key: k }, () => renderConfigChips(t, k));
}

function loadConfig() {
  chrome.storage.local.get(['bgg_token', 'claude_key'], d => {
    if (d.bgg_token) document.getElementById('bgg-token').value = d.bgg_token;
    if (d.claude_key) document.getElementById('claude-key').value = d.claude_key;
    renderConfigChips(d.bgg_token, d.claude_key);
  });
}

function renderConfigChips(t, k) {
  document.getElementById('config-chips').innerHTML =
    `<span class="chip ${t ? 'on' : 'off'}">${t ? '✓ BGG TOKEN' : '✗ BGG TOKEN'}</span>
     <span class="chip ${k ? 'on' : 'off'}">${k ? '✓ CLAUDE KEY' : '✗ CLAUDE KEY'}</span>`;
}

function toggleVis(id, el) {
  const inp = document.getElementById(id);
  inp.type = inp.type === 'password' ? 'text' : 'password';
  el.textContent = inp.type === 'password' ? 'SHOW' : 'HIDE';
}

function getToken() {
  const t = document.getElementById('bgg-token').value.trim();
  if (!t) { alert('Add your BGG token in the Config tab first.'); throw new Error('No token'); }
  return t;
}

function getKey() {
  const k = document.getElementById('claude-key').value.trim();
  if (!k) { alert('Add your Anthropic API key in the Config tab first.'); throw new Error('No key'); }
  return k;
}

async function searchGame() {
  const q = document.getElementById('search-q').value.trim();
  if (!q) return;
  let token;
  try { token = getToken(); } catch(e) { return; }
  const res = document.getElementById('search-results');
  res.classList.remove('hidden');
  res.innerHTML = '<div style="color:var(--muted);font-size:10px;padding:6px;">Searching...</div>';
  const yearFilter = document.getElementById('search-year').value.trim();
  try {
    const r = await fetch(`${BGG}/search?query=${encodeURIComponent(q)}&type=boardgame`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const xml = await r.text();
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    let allItems = Array.from(doc.querySelectorAll('item'));
    if (yearFilter) {
      allItems = allItems.filter(item => {
        const y = item.querySelector('yearpublished')?.getAttribute('value') || '';
        return y === yearFilter;
      });
    }
    const items = allItems.slice(0, 20);
    if (!items.length) {
      res.innerHTML = `<div style="color:var(--muted);font-size:10px;padding:6px;">No results${yearFilter ? ' for year ' + yearFilter : ''}.</div>`;
      return;
    }

    // Render basic results first
    res.innerHTML = '';
    const itemData = items.map(item => ({
      id:   item.getAttribute('id'),
      name: item.querySelector('name[type="primary"]')?.getAttribute('value') || 'Unknown',
      year: item.querySelector('yearpublished')?.getAttribute('value') || '?'
    }));

    itemData.forEach(({ id, name, year }) => {
      const div = document.createElement('div');
      div.className = 'result-item';
      div.id = `result-${id}`;
      div.innerHTML = `
        <div class="result-thumb-placeholder" id="thumb-${id}">🎲</div>
        <div class="result-info">
          <div class="result-name">${name}</div>
          <div class="result-meta">${year}</div>
          <div class="result-id">#${id}</div>
        </div>`;
      div.addEventListener('click', () => selectGame(div, id, name, year));
      res.appendChild(div);
    });

    // Fetch thumbnails in background (batch, max 20 per request)
    const ids = itemData.map(i => i.id).join(',');
    try {
      const tr = await fetch(`${BGG}/thing?id=${ids}&type=boardgame`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const txml = await tr.text();
      const tdoc = new DOMParser().parseFromString(txml, 'text/xml');
      Array.from(tdoc.querySelectorAll('item')).forEach(item => {
        const id    = item.getAttribute('id');
        const thumb = item.querySelector('thumbnail')?.textContent?.trim();
        const el    = document.getElementById(`thumb-${id}`);
        if (el && thumb) {
          el.outerHTML = `<img class="result-thumb" src="${thumb}" alt="" id="thumb-${id}" onerror="this.outerHTML='<div class=result-thumb-placeholder>🎲</div>'" />`;
        }
      });
    } catch(e) { /* thumbnails optional, ignore errors */ }

  } catch(e) {
    res.innerHTML = `<div style="color:var(--error);font-size:10px;padding:6px;">Error: ${e.message}</div>`;
  }
}

async function selectGame(el, id, name, year) {
  const resList = document.getElementById('search-results');
  document.querySelectorAll('.result-item').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  resList.classList.add('has-selection');
  state.game  = { id, name, year };
  state.forum = null;
  state.threads = [];
  state.lastScrapeDate = null;
  state.faqText = '';

  // Reset forum grid
  document.getElementById('forum-grid').classList.remove('has-selection');
  document.querySelectorAll('.forum-item').forEach(e => e.classList.remove('selected'));

  // Hide all scrape output
  document.getElementById('scrape-section').classList.add('hidden');
  document.getElementById('done-banner').classList.add('hidden');
  document.getElementById('progress-wrap').classList.add('hidden');
  document.getElementById('log').classList.add('hidden');
  document.getElementById('log').innerHTML = '';
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('progress-text').textContent = '';

  // Disable download buttons
  document.getElementById('btn-dl-txt').disabled  = true;
  document.getElementById('btn-dl-json').disabled = true;
  document.getElementById('btn-gen-faq').disabled = true;

  await loadForums(id);
}

async function loadForums(gameId) {
  let token;
  try { token = getToken(); } catch(e) { return; }
  const sec  = document.getElementById('forum-section');
  const grid = document.getElementById('forum-grid');
  sec.classList.remove('hidden');
  grid.innerHTML = '<div style="color:var(--muted);font-size:10px;">Loading forums...</div>';
  try {
    const r = await fetch(`${BGG}/forumlist?id=${gameId}&type=thing`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const xml = await r.text();
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    grid.innerHTML = '';
    Array.from(doc.querySelectorAll('forum')).forEach(f => {
      const fid   = f.getAttribute('id');
      const title = f.getAttribute('title');
      const num   = f.getAttribute('numthreads') || '0';
      const div   = document.createElement('div');
      div.className = 'forum-item';
      div.innerHTML = `<div class="forum-item-name">${title}</div><div class="forum-item-count">${num} threads</div>`;
      div.addEventListener('click', () => selectForum(div, fid, title, parseInt(num)));
      grid.appendChild(div);
    });
    document.getElementById('scrape-section').classList.remove('hidden');
  } catch(e) {
    grid.innerHTML = `<div style="color:var(--error);font-size:10px;">${e.message}</div>`;
  }
}

function selectForum(el, id, title, numthreads) {
  const grid = document.getElementById('forum-grid');
  const wasSelected = el.classList.contains('selected');

  // Toggle: clicking selected forum deselects everything
  document.querySelectorAll('.forum-item').forEach(e => e.classList.remove('selected'));

  if (wasSelected) {
    // Deselect — reset grid
    grid.classList.remove('has-selection');
    state.forum = null;
  } else {
    // Select — highlight chosen, dim others
    el.classList.add('selected');
    grid.classList.add('has-selection');
    state.forum = { id, title, numthreads };
  }
  updateScrapeMode();
}

function setMode(m) {
  state.mode = m;
  document.getElementById('mode-full').classList.toggle('active', m === 'full');
  document.getElementById('mode-update').classList.toggle('active', m === 'update');
  updateScrapeMode();
}

function updateScrapeMode() {
  const info = document.getElementById('update-info');
  if (state.mode === 'update' && state.threads.length) {
    info.classList.remove('hidden');
    const date = state.lastScrapeDate ? new Date(state.lastScrapeDate).toLocaleDateString() : 'unknown';
    info.innerHTML = `Existing: <span style="color:var(--success)">${state.threads.length} threads</span> · Last scrape: ${date}`;
  } else {
    info.classList.add('hidden');
  }
}


function showConfirmModal({ game, forum, toFetch, totalThreads, timeStr, isUpdate, existingCount }) {
  return new Promise(resolve => {
    // Remove existing modal if any
    const existing = document.getElementById('confirm-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'confirm-modal-overlay';

    const noNew = isUpdate && toFetch === 0;

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-title">
          <span class="modal-icon">${noNew ? 'ℹ️' : '🔍'}</span>
          ${noNew ? 'Already Up to Date' : (isUpdate ? 'Update Scrape' : 'Confirm Scrape')}
        </div>
        <div class="modal-body">
          <div class="modal-stat">
            <span class="modal-stat-label">Game</span>
            <span class="modal-stat-value">${game}</span>
          </div>
          <div class="modal-stat">
            <span class="modal-stat-label">Forum</span>
            <span class="modal-stat-value">${forum}</span>
          </div>
          ${isUpdate ? `
          <div class="modal-stat">
            <span class="modal-stat-label">Existing threads</span>
            <span class="modal-stat-value">${existingCount}</span>
          </div>
          <div class="modal-stat">
            <span class="modal-stat-label">New threads found</span>
            <span class="modal-stat-value ${toFetch > 0 ? 'accent' : ''}">${toFetch}</span>
          </div>
          <div class="modal-stat">
            <span class="modal-stat-label">Delta basis</span>
            <span class="modal-stat-value" style="font-size:9px;">Thread IDs from last scrape</span>
          </div>
          ` : `
          <div class="modal-stat">
            <span class="modal-stat-label">Threads to fetch</span>
            <span class="modal-stat-value accent">${toFetch}</span>
          </div>
          `}
          ${!noNew ? `
          <div class="modal-stat">
            <span class="modal-stat-label">Estimated time</span>
            <span class="modal-stat-value warn">${timeStr}</span>
          </div>
          ` : ''}
          ${noNew ? '<div style="margin-top:10px;color:var(--success);">No new threads since last scrape. Your data is current.</div>' : ''}
        </div>
        <div class="modal-actions">
          ${noNew
            ? `<button class="btn btn-primary" id="modal-ok">OK</button>`
            : `<button class="btn btn-ghost btn-sm" id="modal-cancel">Cancel</button>
               <button class="btn btn-primary" id="modal-confirm">Scrape ${toFetch} thread${toFetch !== 1 ? 's' : ''}</button>`
          }
        </div>
      </div>`;

    document.body.appendChild(overlay);

    if (noNew) {
      document.getElementById('modal-ok').addEventListener('click', () => {
        overlay.remove(); resolve(false);
      });
    } else {
      document.getElementById('modal-cancel').addEventListener('click', () => {
        overlay.remove(); resolve(false);
      });
      document.getElementById('modal-confirm').addEventListener('click', () => {
        overlay.remove(); resolve(true);
      });
    }

    // Click outside to cancel
    overlay.addEventListener('click', e => {
      if (e.target === overlay) { overlay.remove(); resolve(false); }
    });
  });
}

async function startScrape() {
  if (!state.forum) { alert('Select a forum first.'); return; }
  let token;
  try { token = getToken(); } catch(e) { return; }
  const btn = document.getElementById('btn-scrape');

  // ── Step 1: get thread list first for confirmation ──────────────────────────
  btn.disabled = true; btn.textContent = 'Loading...';
  showEl('progress-wrap'); showEl('log'); clearLog();
  document.getElementById('done-banner').classList.add('hidden');
  // Reset FAQ state for fresh scrape
  if (state.mode === 'full') {
    state.faqText = '';
    document.getElementById('faq-preview').classList.add('hidden');
    document.getElementById('btn-dl-faq').disabled = true;
    const err = document.getElementById('faq-error');
    if (err) err.remove();
  }
  setProgress('progress-fill', 'progress-text', 0, 1, 'Fetching thread list...');

  let allMeta = [];
  try {
    let page = 1;
    while (true) {
      const r = await fetch(`${BGG}/forum?id=${state.forum.id}&page=${page}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const xml = await r.text();
      if (xml.includes('Unauthorized')) { log('Unauthorized — check BGG token in Config.', 'err'); btn.disabled = false; btn.textContent = 'Scrape Threads'; return; }
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const threads = Array.from(doc.querySelectorAll('thread'));
      if (!threads.length) break;
      threads.forEach(t => allMeta.push({ id: t.getAttribute('id'), subject: t.getAttribute('subject') }));
      const total = parseInt(doc.querySelector('forum')?.getAttribute('numthreads') || '0');
      setProgress('progress-fill', 'progress-text', allMeta.length, total, `Thread list: ${allMeta.length}/${total}`);
      if (allMeta.length >= total) break;
      page++;
      await SLEEP(800);
    }
  } catch(e) {
    log('Error fetching thread list: ' + e.message, 'err');
    btn.disabled = false; btn.textContent = 'Scrape Threads'; return;
  }

  log(`${allMeta.length} threads found.`, 'ok');

  // ── Step 2: filter delta if update mode ─────────────────────────────────────
  let toFetch = allMeta;
  if (state.mode === 'update' && state.threads.length) {
    const existing = new Set(state.threads.map(t => t.id));
    toFetch = allMeta.filter(t => !existing.has(t.id));
    log(`Update mode: ${toFetch.length} new threads (${allMeta.length - toFetch.length} already have).`, 'warn');
  }

  if (!toFetch.length) {
    log('No new threads — already up to date.', 'ok');
    setProgress('progress-fill', 'progress-text', 1, 1, '✓ Already up to date');
    enableDownloads(); btn.disabled = false; btn.textContent = 'Scrape Threads'; return;
  }

  // ── Step 3: confirmation modal ───────────────────────────────────────────────
  const RATE_MS   = 700;
  const totalSecs = Math.ceil((toFetch.length * RATE_MS) / 1000);
  const mins      = Math.floor(totalSecs / 60);
  const secs      = totalSecs % 60;
  const timeStr   = mins > 0 ? `~${mins}m ${secs}s` : `~${secs}s`;
  const isUpdate  = state.mode === 'update';

  const confirmed = await showConfirmModal({
    game: state.game?.name || '',
    forum: state.forum?.title || '',
    toFetch: toFetch.length,
    totalThreads: allMeta.length,
    timeStr,
    isUpdate,
    existingCount: state.threads.length
  });

  if (!confirmed) {
    log('Scrape cancelled.', 'warn');
    setProgress('progress-fill', 'progress-text', 0, 1, 'Cancelled');
    btn.disabled = false; btn.textContent = 'Scrape Threads'; return;
  }

  // ── Step 4: fetch each thread with live ETA ──────────────────────────────────
  btn.textContent = 'Scraping...';
  const newThreads = [];
  const startTime  = Date.now();

  for (let i = 0; i < toFetch.length; i++) {
    const { id, subject } = toFetch[i];
    const elapsed   = (Date.now() - startTime) / 1000;
    const done      = i + 1;
    const pct       = Math.round((done / toFetch.length) * 100);
    const rate      = i > 0 ? elapsed / i : null;          // secs per thread
    const remaining = rate ? Math.ceil(rate * (toFetch.length - done)) : null;
    const etaStr    = remaining !== null
      ? (remaining >= 60
          ? `${Math.floor(remaining/60)}m ${remaining%60}s left`
          : `${remaining}s left`)
      : 'calculating...';

    setProgress(
      'progress-fill', 'progress-text',
      done, toFetch.length,
      `${pct}% — thread ${done}/${toFetch.length} — ${etaStr}`
    );
    log(`[${pct}%] ${subject.substring(0, 60)}`, '');

    try {
      const r = await fetch(`${BGG}/thread?id=${id}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const xml = await r.text();
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const posts = Array.from(doc.querySelectorAll('article')).map(a => ({
        author: a.getAttribute('username') || '',
        date:   a.getAttribute('postdate') || '',
        body:   a.querySelector('body')?.textContent?.trim() || ''
      })).filter(p => p.body.length > 5);
      newThreads.push({ id, subject, posts });
    } catch(e) {
      log(`Error thread ${id}: ${e.message}`, 'err');
    }
    await SLEEP(600);
  }

  // ── Step 5: finalise ─────────────────────────────────────────────────────────
  state.threads = state.mode === 'update' ? [...state.threads, ...newThreads] : newThreads;
  state.lastScrapeDate = new Date().toISOString();

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const summary = `✓ ${state.threads.length} threads — completed in ${totalElapsed}s`;
  setProgress('progress-fill', 'progress-text', 1, 1, summary);
  log(summary, 'ok');

  enableDownloads(); saveGame(); updateFAQSourceInfo();

  // Show completion banner
  const banner = document.getElementById('done-banner');
  document.getElementById('done-text').innerHTML =
    `${state.threads.length} threads scraped in ${totalElapsed}s<br>` +
    `Game: ${state.game?.name || ''}<br>` +
    `Forum: ${state.forum?.title || ''}<br><br>` +
    `What would you like to do next?`;
  banner.classList.remove('hidden');
  banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  btn.disabled = false; btn.textContent = 'Scrape Threads';
}

function enableDownloads() {
  ['btn-dl-txt','btn-dl-json','btn-gen-faq'].forEach(id => { document.getElementById(id).disabled = false; });
}

function updateFAQSourceInfo() {
  const el = document.getElementById('faq-source-info');
  if (state.threads.length) {
    const date = state.lastScrapeDate ? new Date(state.lastScrapeDate).toLocaleDateString() : 'unknown';
    el.innerHTML = `<span style="color:var(--success);">✓ ${state.threads.length} threads</span> — ${state.game?.name || ''} · ${state.forum?.title || ''}<br><span style="color:var(--muted);">Last scrape: ${date}</span>`;
  } else {
    el.textContent = 'No scrape data. Run a scrape first or load a saved game.';
  }
  // Only show download + preview if FAQ actually exists
  if (!state.faqText) {
    document.getElementById('btn-dl-faq').disabled = true;
    document.getElementById('faq-preview').classList.add('hidden');
    document.getElementById('faq-progress-wrap').classList.add('hidden');
  }
}



function loadFAQFile(input) {
  const file = input.files[0];
  if (!file) return;
  if (!file.name.endsWith('.md')) {
    showFAQUploadStatus('Only .md files are supported.', 'err');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    // Extract metadata comment
    const match = text.match(/\[\/\/\]: # \(BGG-FAQ-META:(.*?)\)/);
    if (!match) {
      showFAQUploadStatus('This file has no BGG FAQ metadata. Only files generated by this extension can be updated.', 'err');
      return;
    }
    try {
      const meta = JSON.parse(match[1]);
      state.game           = meta.game;
      state.forum          = meta.forum;
      state.lastScrapeDate = meta.lastScrapeDate;
      // Restore thread IDs as stubs (no post content needed — just IDs for delta)
      state.threads        = (meta.threadIds || []).map(id => ({ id, subject: '', posts: [] }));

      const scrapeDate = new Date(meta.lastScrapeDate).toLocaleDateString();
      const genDate    = new Date(meta.generatedAt).toLocaleDateString();
      showFAQUploadStatus(
        `✓ Loaded: ${meta.game?.name} · ${meta.forum?.title}\n` +
        `Last scrape: ${scrapeDate} · ${state.threads.length} threads · FAQ generated: ${genDate}`,
        'ok'
      );

      // Switch to scrape tab, load forums, pre-select update mode
      const scrapeTab = document.querySelector('.tab[data-tab="scrape"]');
      showTab('scrape', scrapeTab);
      document.getElementById('search-q').value = meta.game?.name || '';
      setMode('update');
      loadForums(meta.game?.id);
      updateFAQSourceInfo();
    } catch(e) {
      showFAQUploadStatus('Failed to parse metadata: ' + e.message, 'err');
    }
  };
  reader.readAsText(file);
}

function showFAQUploadStatus(msg, type) {
  const el = document.getElementById('faq-upload-status');
  el.textContent = msg;
  el.style.color = type === 'ok' ? 'var(--success)' : 'var(--error)';
  el.classList.remove('hidden');
}

function showFAQError(msg) {
  // Remove existing error
  const existing = document.getElementById('faq-error');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.id = 'faq-error';
  div.style.cssText = 'margin-top:10px;padding:12px;background:rgba(255,112,112,0.08);border:1px solid rgba(255,112,112,0.4);border-radius:6px;';
  div.innerHTML = `
    <div style="font-family:var(--mono);font-size:10px;color:var(--error);margin-bottom:8px;">⚠ ${msg}</div>
    <button class="btn btn-ghost btn-sm" id="btn-retry-faq">↺ Retry</button>
  `;
  document.getElementById('faq-progress-wrap').after(div);
  document.getElementById('btn-retry-faq').addEventListener('click', () => {
    div.remove();
    generateFAQ();
  });
  setFAQProgress(0, 1, '');
  document.getElementById('faq-progress-wrap').classList.add('hidden');
}

async function generateFAQ() {
  if (!state.threads.length) { alert('No data. Run a scrape first.'); return; }
  let key;
  try { key = getKey(); } catch(e) { return; }
  const btn = document.getElementById('btn-gen-faq');
  btn.disabled = true; btn.textContent = 'Generating...';
  showEl('faq-progress-wrap');
  setFAQProgress(0, 1, 'Building corpus...');
  // Always start fresh — clear any previous FAQ
  state.faqText = '';
  document.getElementById('faq-preview').classList.add('hidden');
  document.getElementById('faq-preview').textContent = '';
  document.getElementById('btn-dl-faq').disabled = true;
  const existing = document.getElementById('faq-error');
  if (existing) existing.remove();

  const gameName  = state.game?.name || 'the game';
  const forumName = state.forum?.title || 'Rules';
  const extra     = document.getElementById('faq-instructions').value.trim();
  let corpus = '';
  state.threads.forEach(t => {
    corpus += `\n\n### THREAD: ${t.subject}\n`;
    t.posts.forEach(p => { corpus += `[${p.author}]: ${p.body}\n`; });
  });
  const MAX = 75000;
  const chunks = [];
  for (let i = 0; i < corpus.length; i += MAX) chunks.push(corpus.slice(i, i + MAX));
  setFAQProgress(0, chunks.length, `${chunks.length} chunk(s) to process...`);
  const parts = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    setFAQProgress(ci + 1, chunks.length, `Claude processing chunk ${ci+1}/${chunks.length}...`);
    const prompt = chunks.length > 1
      ? `Extract rules Q&A from this BGG forum chunk (${ci+1}/${chunks.length}) for "${gameName}". Format:\n## Q: [question]\n**A:** [answer]\nOnly include questions with clear answers.${extra ? '\nFocus: ' + extra : ''}\n\n${chunks[ci]}`
      : `You are a board game rules expert. Analyze all threads from the "${forumName}" forum for "${gameName}" on BoardGameGeek.\n\nCreate a comprehensive FAQ in markdown:\n- Brief intro paragraph\n- Group entries under ## thematic headings\n- Format: **Q:** question followed by **A:** answer\n- Note designer responses where present\n- Be precise and concise${extra ? '\n\nExtra focus: ' + extra : ''}\n\nForum data:\n${chunks[ci]}`;
    try {
      const resp = await fetch(CLAUDE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] })
      });
      const data = await resp.json();
      if (data.error) {
        showFAQError('API error: ' + data.error.message);
        btn.disabled = false; btn.textContent = 'Generate FAQ';
        return;
      }
      parts.push(data.content?.[0]?.text || '');
    } catch(e) {
      showFAQError('Request failed: ' + e.message);
      btn.disabled = false; btn.textContent = 'Generate FAQ';
      return;
    }
    await SLEEP(500);
  }
  if (parts.length > 1) {
    setFAQProgress(1, 1, 'Synthesizing...');
    try {
      const resp = await fetch(CLAUDE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, messages: [{ role: 'user', content: `Combine and deduplicate these FAQ sections for "${gameName}" into one organized markdown FAQ.\n\n${parts.join('\n\n---\n\n')}` }] })
      });
      const data = await resp.json();
      state.faqText = data.content?.[0]?.text || parts.join('\n\n');
    } catch(e) { state.faqText = parts.join('\n\n'); }
  } else {
    state.faqText = parts[0] || '';
  }
  const preview = document.getElementById('faq-preview');
  preview.classList.remove('hidden');
  preview.textContent = state.faqText;
  document.getElementById('btn-dl-faq').disabled = false;
  setFAQProgress(1, 1, '✓ FAQ ready');
  btn.disabled = false; btn.textContent = 'Generate FAQ';
}

function downloadTxt() {
  if (!state.threads.length) return;
  let out = `${state.game?.name} — BGG ${state.forum?.title} Forum\nScraped: ${state.lastScrapeDate}\nThreads: ${state.threads.length}\n${'='.repeat(60)}\n\n`;
  state.threads.forEach(t => {
    out += `${'='.repeat(60)}\nTHREAD: ${t.subject}\nURL: https://boardgamegeek.com/thread/${t.id}/\n${'='.repeat(60)}\n\n`;
    t.posts.forEach((p, i) => { out += `[${i+1}] ${p.author} (${p.date})\n${p.body}\n\n`; });
  });
  dl(out, `${slug(state.game?.name)}-${slug(state.forum?.title)}.txt`, 'text/plain');
}

function downloadJSON() {
  if (!state.threads.length) return;
  dl(JSON.stringify({ game: state.game, forum: state.forum, lastScrapeDate: state.lastScrapeDate, threads: state.threads }, null, 2),
    `${slug(state.game?.name)}-state.json`, 'application/json');
}

function downloadFAQ() {
  if (!state.faqText) return;
  dl(`# ${state.game?.name} — ${state.forum?.title} FAQ\n_Generated from BGG forum · ${new Date().toLocaleDateString()}_\n\n` + state.faqText,
    `${slug(state.game?.name)}-faq.md`, 'text/markdown');
}

function dl(content, filename, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename; a.click();
}

function slug(s) { return (s || 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function saveGame() {
  if (!state.game) return;
  chrome.storage.local.set({ [`game_${state.game.id}_${state.forum?.id || '0'}`]: JSON.stringify({
    game: state.game, forum: state.forum, lastScrapeDate: state.lastScrapeDate, threadCount: state.threads.length
  })});
}

function renderSaved() {
  chrome.storage.local.get(null, items => {
    const keys = Object.keys(items).filter(k => k.startsWith('game_'));
    const wrap = document.getElementById('saved-list');
    if (!keys.length) { wrap.innerHTML = '<div style="color:var(--muted);font-size:11px;">No saved games yet.</div>'; return; }
    wrap.innerHTML = '';
    keys.forEach(k => {
      const d = JSON.parse(items[k]);
      const date = d.lastScrapeDate ? new Date(d.lastScrapeDate).toLocaleDateString() : '—';
      const div = document.createElement('div');
      div.className = 'saved-item';
      div.innerHTML = `
        <div class="saved-item-top"><span class="saved-item-name">${d.game.name} <span style="color:var(--muted);font-weight:400">(${d.game.year})</span></span></div>
        <div class="saved-item-meta">${d.forum?.title || '?'} · ${d.threadCount} threads</div>
        <div class="saved-item-meta" style="color:var(--accent);margin-top:2px;">Last scrape: ${date}</div>
        <div class="saved-item-actions">
          <button class="btn-micro" data-load="${k}">Load</button>
          <button class="btn-micro red" data-del="${k}">Delete</button>
        </div>`;
      div.querySelector('[data-load]').addEventListener('click', () => loadSaved(k));
      div.querySelector('[data-del]').addEventListener('click', () => deleteSaved(k));
      wrap.appendChild(div);
    });
  });
}

function loadSaved(key) {
  chrome.storage.local.get(key, items => {
    const d = JSON.parse(items[key]);
    state.game = d.game; state.forum = d.forum; state.lastScrapeDate = d.lastScrapeDate;
    document.getElementById('search-q').value = d.game.name;
    showTab('scrape', document.querySelector('.tab[data-tab="scrape"]'));
    loadForums(d.game.id);
    updateFAQSourceInfo();
    alert(`Loaded ${d.game.name}. Use Update mode to fetch only new threads.`);
  });
}

function deleteSaved(key) { chrome.storage.local.remove(key, () => renderSaved()); }

function showEl(id) { document.getElementById(id).classList.remove('hidden'); }

function setProgress(fillId, textId, val, total, text) {
  document.getElementById(fillId).style.width = (total > 0 ? (val / total * 100) : 0) + '%';
  document.getElementById(textId).textContent = text;
}

function setFAQProgress(val, total, text) { setProgress('faq-progress-fill', 'faq-progress-text', val, total, text); }

function log(msg, type) {
  const el = document.getElementById('log');
  const line = document.createElement('div');
  line.className = 'log-line' + (type ? ' log-' + type : '');
  line.textContent = `[${new Date().toTimeString().slice(0,8)}] ${msg}`;
  el.appendChild(line); el.scrollTop = el.scrollHeight;
}

function clearLog() { document.getElementById('log').innerHTML = ''; }
