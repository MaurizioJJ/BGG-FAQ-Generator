import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = [
  'background.js', 'src/app.js', 'src/anthropic-api.js', 'src/bgg-api.js',
  'src/exports.js', 'src/faq-source.js', 'src/storage.js', 'src/utils.js'
];
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const packageInfo = JSON.parse(readFileSync('package.json', 'utf8'));
if (manifest.manifest_version !== 3 || manifest.version !== packageInfo.version) throw new Error('Expected Manifest V3 with matching package and manifest versions.');
if (!manifest.side_panel?.default_path) throw new Error('Missing side panel path.');
const html = readFileSync('sidepanel.html', 'utf8');
const app = readFileSync('src/app.js', 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) throw new Error(`Duplicate HTML ids: ${[...new Set(duplicates)].join(', ')}`);
const referencedIds = [...app.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
const missingIds = [...new Set(referencedIds.filter(id => !ids.includes(id)))];
if (missingIds.length) throw new Error(`App references missing HTML ids: ${missingIds.join(', ')}`);
console.log(`Validated ${files.length} JavaScript files and manifest.json.`);
