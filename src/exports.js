import { escapeHtml, slug } from './utils.js';

const META_PREFIX = 'BGG-FAQ-V2:';

function encodeMetadata(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = ''; bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function decodeMetadata(value) {
  const binary = atob(value); const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function faqMarkdown(dataset) {
  if (!dataset.faq?.text) throw new Error('This dataset has no generated FAQ.');
  const metadata = encodeMetadata({ schemaVersion: 2, dataset });
  return `<!-- ${META_PREFIX}${metadata} -->\n# ${dataset.game.name} — ${dataset.forum.title} FAQ\n\n` +
    `_Generated ${new Date(dataset.faq.generatedAt).toLocaleString()} from BoardGameGeek forum discussions. Verify answers against official rules._\n\n` +
    `${dataset.faq.text}\n\n---\nSource data: [BoardGameGeek](https://boardgamegeek.com) · Generated with ${dataset.faq.model}\n`;
}

export function importFaqMarkdown(markdown) {
  const match = String(markdown).match(new RegExp(`<!--\\s*${META_PREFIX}([A-Za-z0-9+/=]+)\\s*-->`));
  if (!match) throw new Error('No BGG FAQ Generator v2 metadata was found.');
  const metadata = decodeMetadata(match[1]);
  if (metadata.schemaVersion !== 2 || metadata.dataset?.schemaVersion !== 2) throw new Error('Unsupported FAQ metadata version.');
  return metadata.dataset;
}

export function faqHtml(dataset) {
  const markdown = faqMarkdown(dataset).replace(/^<!--.*-->\n/, '');
  const body = escapeHtml(markdown)
    .replace(/^# (.*)$/gm, '<h1>$1</h1>').replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.*?)\]\((https:\/\/[^)]+)\)/g, '<a href="$2">$1</a>').replace(/\n/g, '<br>');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(dataset.game.name)} FAQ</title><style>body{font:16px/1.55 system-ui;max-width:850px;margin:40px auto;padding:0 24px;color:#222}h1,h2,h3{line-height:1.2}a{color:#1769aa}@media print{body{margin:0;max-width:none}a{color:#000}}</style></head><body>${body}</body></html>`;
}

export function datasetJson(dataset) { return JSON.stringify(dataset, null, 2); }
export function datasetText(dataset) {
  const lines = [`${dataset.game.name} — ${dataset.forum.title}`, `Scraped: ${dataset.scrape.completedAt || dataset.updatedAt}`, `Threads: ${dataset.threads.length}`, ''];
  dataset.threads.forEach(thread => {
    lines.push('='.repeat(72), `THREAD: ${thread.subject}`, `SOURCE: ${thread.url}`, '');
    thread.posts.forEach(post => lines.push(`[${post.author || 'anonymous'} | ${post.date || 'unknown'}] ${post.url}`, post.body, ''));
  });
  return lines.join('\n');
}
export function filenames(dataset) { const base = `${slug(dataset.game.name)}-${slug(dataset.forum.title)}`; return { base, md: `${base}-faq.md`, html: `${base}-faq.html`, json: `${base}-data.json`, txt: `${base}-threads.txt` }; }
