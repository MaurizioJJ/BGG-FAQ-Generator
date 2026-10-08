import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { download } from '../src/utils.js';

test('exports use the native save dialog and retain the blob until accepted', async () => {
  const originalChrome = globalThis.chrome;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked = [];
  let blob;
  URL.createObjectURL = value => { blob = value; return 'blob:faq-test'; };
  URL.revokeObjectURL = url => revoked.push(url);
  globalThis.chrome = { downloads: { download: async options => {
    assert.deepEqual(options, { url: 'blob:faq-test', filename: 'game-faq.md', saveAs: true });
    assert.deepEqual(revoked, []);
    assert.equal(await blob.text(), '# FAQ — café');
    assert.equal(blob.type, 'text/markdown');
    return 42;
  } } };
  try {
    assert.equal(await download('# FAQ — café', 'game-faq.md', 'text/markdown'), 42);
    assert.deepEqual(revoked, ['blob:faq-test']);
  } finally {
    globalThis.chrome = originalChrome;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test('download failures reach the caller and release the blob', async () => {
  const originalChrome = globalThis.chrome;
  const originalRevoke = URL.revokeObjectURL;
  const revoked = [];
  const failure = new Error('User cancelled the save dialog');
  globalThis.chrome = { downloads: { download: async () => { throw failure; } } };
  URL.revokeObjectURL = url => revoked.push(url);
  try {
    await assert.rejects(async () => download('FAQ', 'faq.html', 'text/html'), error => error === failure);
    assert.equal(revoked.length, 1);
  } finally {
    globalThis.chrome = originalChrome;
    URL.revokeObjectURL = originalRevoke;
  }
});

test('extension declares the native downloads permission', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.permissions.includes('downloads'));
});
