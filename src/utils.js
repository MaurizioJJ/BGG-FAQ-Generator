export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function slug(value) {
  return String(value || 'game').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'game';
}

export function approximateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function formatDuration(seconds) {
  if (seconds < 60) return `~${Math.ceil(seconds)} seconds`;
  return `~${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

export function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function uniqueCsv(value) {
  return [...new Set(String(value || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean))];
}

export function safeDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date : null;
}

export function setChildren(parent, ...children) {
  parent.replaceChildren(...children.filter(Boolean));
  return parent;
}

export function element(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs) Object.entries(options.attrs).forEach(([key, value]) => node.setAttribute(key, value));
  children.filter(Boolean).forEach(child => node.append(child));
  return node;
}
