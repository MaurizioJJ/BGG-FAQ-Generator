import { sleep } from './utils.js';

const ROOT = 'https://boardgamegeek.com/xmlapi2';

export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'ApiError'; this.status = status; }
}

function parseXml(text) {
  const document = new DOMParser().parseFromString(text, 'application/xml');
  const parseError = document.querySelector('parsererror');
  if (parseError) throw new ApiError('BoardGameGeek returned invalid XML.');
  return document;
}

export async function requestXml(path, token, options = {}) {
  const retries = options.retries ?? 4;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout ?? 20000);
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(`${ROOT}${path}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal
      });
      const text = await response.text();
      if (response.status === 401 || response.status === 403) throw new ApiError('BGG rejected the application token.', response.status);
      if (response.status === 202 || response.status === 429 || response.status >= 500) {
        if (attempt === retries) throw new ApiError(`BGG is busy (HTTP ${response.status}). Try again later.`, response.status);
        const retryAfter = Number(response.headers.get('retry-after')) || 2 ** attempt;
        await sleep(Math.min(retryAfter * 1000, 15000));
        continue;
      }
      if (!response.ok) throw new ApiError(`BGG request failed (HTTP ${response.status}).`, response.status);
      return parseXml(text);
    } catch (error) {
      if (error.name === 'AbortError') throw new ApiError(options.signal?.aborted ? 'BGG request cancelled.' : 'BGG request timed out.');
      if (attempt === retries || error instanceof ApiError) throw error;
      await sleep(2 ** attempt * 1000);
    } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
  }
  throw new ApiError('BGG request failed.');
}

export async function searchGames(query, year, token, signal) {
  const document = await requestXml(`/search?query=${encodeURIComponent(query)}&type=boardgame`, token, { signal });
  let games = [...document.querySelectorAll('item')].map(item => ({
    id: item.getAttribute('id'),
    name: item.querySelector('name[type="primary"]')?.getAttribute('value') || 'Unknown',
    year: item.querySelector('yearpublished')?.getAttribute('value') || ''
  }));
  if (year) games = games.filter(game => game.year === year);
  games = games.slice(0, 20);
  if (games.length) {
    try {
      const details = await requestXml(`/thing?id=${games.map(game => game.id).join(',')}&type=boardgame`, token, { signal });
      const thumbnails = new Map([...details.querySelectorAll('item')].map(item => [item.getAttribute('id'), item.querySelector('thumbnail')?.textContent?.trim()]));
      games.forEach(game => { game.thumbnail = thumbnails.get(game.id) || ''; });
    } catch { /* Search results remain usable without thumbnails. */ }
  }
  return games;
}

export async function getForums(gameId, token, signal) {
  const document = await requestXml(`/forumlist?id=${encodeURIComponent(gameId)}&type=thing`, token, { signal });
  return [...document.querySelectorAll('forum')].map(forum => ({
    id: forum.getAttribute('id'), title: forum.getAttribute('title') || 'Forum',
    numThreads: Number(forum.getAttribute('numthreads') || 0)
  }));
}

export async function getForumThreads(forumId, token, onPage, signal) {
  const threads = [];
  for (let page = 1; ; page++) {
    const document = await requestXml(`/forum?id=${encodeURIComponent(forumId)}&page=${page}`, token, { signal });
    const items = [...document.querySelectorAll('thread')].map(thread => ({
      id: thread.getAttribute('id'), subject: thread.getAttribute('subject') || 'Untitled thread',
      author: thread.getAttribute('author') || '', numArticles: Number(thread.getAttribute('numarticles') || 0),
      lastPostDate: thread.getAttribute('lastpostdate') || thread.getAttribute('postdate') || ''
    }));
    if (!items.length) break;
    threads.push(...items);
    onPage?.(threads.length);
    const total = Number(document.querySelector('forum')?.getAttribute('numthreads') || 0);
    if (items.length < 50 || (total && threads.length >= total)) break;
    await sleep(900);
  }
  return threads;
}

export async function getThread(thread, token, signal) {
  const document = await requestXml(`/thread?id=${encodeURIComponent(thread.id)}`, token, { signal });
  const posts = [...document.querySelectorAll('article')].map(article => ({
    id: article.getAttribute('id') || '', author: article.getAttribute('username') || '',
    date: article.getAttribute('postdate') || '', body: article.querySelector('body')?.textContent?.trim() || '',
    url: `https://boardgamegeek.com/thread/${thread.id}#${article.getAttribute('id') || ''}`
  })).filter(post => post.body.length > 5);
  return { ...thread, url: `https://boardgamegeek.com/thread/${thread.id}`, posts };
}
