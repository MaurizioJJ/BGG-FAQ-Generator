const DB_NAME = 'bgg-faq-generator';
const DB_VERSION = 2;
const STORE = 'datasets';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, operation) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE, mode);
    const completion = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    const result = await operation(transaction.objectStore(STORE));
    await completion;
    return result;
  } finally {
    db.close();
  }
}

export const datasets = {
  all: () => withStore('readonly', store => requestResult(store.getAll())),
  get: id => withStore('readonly', store => requestResult(store.get(id))),
  put: value => withStore('readwrite', store => requestResult(store.put(value))),
  delete: id => withStore('readwrite', store => requestResult(store.delete(id))),
  clear: () => withStore('readwrite', store => requestResult(store.clear()))
};

// The BGG token is a low-value forum session id, so remembering it across
// restarts is fine. AI API keys are billable secrets and chrome.storage.local
// is plaintext on disk in the Chrome profile, so they persist only when the
// owner opts in separately; otherwise they live in session storage and any
// copy on disk is purged on load.
const AI_KEYS = ['anthropicKey', 'openaiKey', 'geminiKey'];
const LOCAL_KEYS = ['rememberCredentials', 'rememberAiKeys', 'bggToken', ...AI_KEYS];
const SESSION_KEYS = ['bggToken', ...AI_KEYS];

export async function loadCredentials() {
  const [local, session] = await Promise.all([
    chrome.storage.local.get(LOCAL_KEYS),
    chrome.storage.session.get(SESSION_KEYS)
  ]);
  const remember = Boolean(local.rememberCredentials);
  const rememberAiKeys = Boolean(local.rememberAiKeys);
  if (!rememberAiKeys) await chrome.storage.local.remove(AI_KEYS);
  const aiSource = rememberAiKeys ? local : session;
  return {
    bggToken: (remember ? local.bggToken : session.bggToken) || '',
    anthropicKey: aiSource.anthropicKey || '',
    openaiKey: aiSource.openaiKey || '',
    geminiKey: aiSource.geminiKey || '',
    remember,
    rememberAiKeys
  };
}

export async function saveCredentials(credentials) {
  const aiKeys = { anthropicKey: credentials.anthropicKey || '', openaiKey: credentials.openaiKey || '', geminiKey: credentials.geminiKey || '' };
  await chrome.storage.session.set({ bggToken: credentials.bggToken, ...aiKeys });
  if (credentials.remember) {
    await chrome.storage.local.set({ bggToken: credentials.bggToken, rememberCredentials: true });
  } else {
    await chrome.storage.local.remove(['bggToken']);
    await chrome.storage.local.set({ rememberCredentials: false });
  }
  if (credentials.rememberAiKeys) {
    await chrome.storage.local.set({ ...aiKeys, rememberAiKeys: true });
  } else {
    await chrome.storage.local.remove(AI_KEYS);
    await chrome.storage.local.set({ rememberAiKeys: false });
  }
}

export async function clearCredentials() {
  await Promise.all([
    chrome.storage.local.remove(LOCAL_KEYS),
    chrome.storage.session.remove(SESSION_KEYS)
  ]);
}

export async function exportBackup() {
  return { schemaVersion: 2, exportedAt: new Date().toISOString(), datasets: await datasets.all() };
}

export async function importBackup(backup) {
  if (backup?.schemaVersion !== 2 || !Array.isArray(backup.datasets)) throw new Error('Not a BGG FAQ Generator v2 backup.');
  for (const dataset of backup.datasets) {
    if (!dataset?.id || dataset.schemaVersion !== 2) throw new Error('Backup contains an invalid dataset.');
    await datasets.put(dataset);
  }
  return backup.datasets.length;
}
