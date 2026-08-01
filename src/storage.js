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

const LOCAL_KEYS = ['rememberCredentials', 'bggToken', 'anthropicKey'];

export async function loadCredentials() {
  const local = await chrome.storage.local.get(LOCAL_KEYS);
  if (local.rememberCredentials) return { bggToken: local.bggToken || '', anthropicKey: local.anthropicKey || '', remember: true };
  const session = await chrome.storage.session.get(['bggToken', 'anthropicKey']);
  return { bggToken: session.bggToken || '', anthropicKey: session.anthropicKey || '', remember: false };
}

export async function saveCredentials(credentials) {
  const values = { bggToken: credentials.bggToken, anthropicKey: credentials.anthropicKey };
  if (credentials.remember) {
    await chrome.storage.local.set({ ...values, rememberCredentials: true });
    await chrome.storage.session.clear();
  } else {
    await chrome.storage.local.remove(['bggToken', 'anthropicKey']);
    await chrome.storage.local.set({ rememberCredentials: false });
    await chrome.storage.session.set(values);
  }
}

export async function clearCredentials() {
  await Promise.all([
    chrome.storage.local.remove(LOCAL_KEYS),
    chrome.storage.session.remove(['bggToken', 'anthropicKey'])
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
