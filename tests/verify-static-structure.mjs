import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const productionFiles = [
  'index.html',
  'css/design-system.css',
  'css/index.css',
  'js/app.js',
  'js/board.js',
  'js/firebase-client.js',
  'js/quill-loader.js',
  'tool/tree/tree.html',
  'calc/ascension.html',
  'calc/forge.html',
  'calc/dimension-ev.html',
  'calc/beast-cal/beast-cal.html',
  'tool/path.html',
  'tool/payment.html',
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function isLocalReference(value) {
  return value
    && !value.startsWith('#')
    && !value.startsWith('//')
    && !/^(?:https?:|data:|mailto:|tel:|javascript:)/i.test(value)
    && !/[${}]/.test(value);
}

for (const relativePath of productionFiles) {
  assert.ok(await exists(resolve(root, relativePath)), `missing production file: ${relativePath}`);
}

const indexPath = resolve(root, 'index.html');
const treePath = resolve(root, 'tool/tree/tree.html');
const index = await readFile(indexPath, 'utf8');
const tree = await readFile(treePath, 'utf8');

assert.ok(Buffer.byteLength(index) <= 40 * 1024, 'index.html exceeds the 40KB budget');
assert.ok(Buffer.byteLength(tree) <= 120 * 1024, 'tree.html exceeds the 120KB budget');
assert.doesNotMatch(index, /<style(?:\s|>)/i, 'index.html still contains inline CSS');
assert.doesNotMatch(index, /<script(?![^>]*\bsrc=)[^>]*>/i, 'index.html still contains an inline script');
assert.doesNotMatch(index, /\son[a-z]+\s*=/i, 'index.html still contains inline event handlers');
assert.doesNotMatch(index, /(?:cdn\.jsdelivr\.net[^"']*quill|gstatic\.com[^"']*firebase)/i, 'index.html eagerly references Quill or Firebase');
assert.match(index, /id="contentIframe"[^>]*\bsrc=""/i, 'content iframe must start with an empty src');
assert.doesNotMatch(tree, /_WASM_B64|data:application\/wasm/i, 'tree.html still embeds WASM');
assert.match(tree, /\.loading\s*=\s*['"]lazy['"]/, 'tree images are not lazy loaded');
assert.equal(
  (tree.match(/\{kw:\["영혼최대강화"\],\s*score:4000,\s*dimReturn:true\}/g) || []).length,
  6,
  'all six optimization goals must prioritize 영혼최대강화 with weight 4000',
);
const verticalMapSource = tree.match(/const V_MAP=\[([\s\S]*?)\]\.map/);
assert.ok(verticalMapSource, 'tree vertical connection map is missing');
const verticalRows = [...verticalMapSource[1].matchAll(/'([01]{17})'/g)].map(match => match[1]);
assert.equal(verticalRows.length, 16, 'tree vertical connection map must have 16 rows');
assert.equal(verticalRows[14][6], '1', 'display nodes (7,15) and (7,16) must be connected');

const beast = await readFile(resolve(root, 'calc/beast-cal/beast-cal.html'), 'utf8');
assert.match(beast, /\.loading\s*=\s*['"]lazy['"]/, 'beast images are not lazy loaded');
assert.match(beast, /\.decoding\s*=\s*['"]async['"]/, 'beast images are not asynchronously decoded');
assert.match(beast, /images\/\$\{name\}\.webp/, 'beast cards do not reference WebP images');
const beastImageFiles = await readdir(resolve(root, 'calc/beast-cal/images'));
assert.equal(beastImageFiles.filter(file => file.endsWith('.webp')).length, 33, 'expected 33 beast WebP images');
assert.equal(beastImageFiles.filter(file => file.endsWith('.png')).length, 0, 'obsolete beast PNG images remain');

const app = await readFile(resolve(root, 'js/app.js'), 'utf8');
const board = await readFile(resolve(root, 'js/board.js'), 'utf8');
assert.match(app, /await board\.resumeRedirectIfPending\(\)[\s\S]*showPage\(initialPage\)/, 'redirect recovery is not serialized before initial routing');
assert.match(board, /const boardLoadPromises = new Map\(\)/, 'same-category board requests are not shared');
assert.match(board, /deletePost\(postId, false\)/, 'anonymous delete still uses the extra confirmation');
assert.match(board, /quill\.setSelection\(index \+ 1\)/, 'image upload does not restore the editor cursor');
assert.match(tree, /exportBtn\.disabled=true[\s\S]*finally\s*{[\s\S]*exportBtn\.disabled=false/, 'UID export button is not restored after loading');

const htmlFiles = productionFiles.filter(path => extname(path) === '.html');
for (const relativePath of htmlFiles) {
  const absolutePath = resolve(root, relativePath);
  const source = await readFile(absolutePath, 'utf8');
  const attributePattern = /\b(?:src|href)\s*=\s*["']([^"']*)["']/gi;
  for (const match of source.matchAll(attributePattern)) {
    const reference = match[1].split(/[?#]/, 1)[0];
    if (!isLocalReference(reference)) continue;
    const target = resolve(dirname(absolutePath), decodeURIComponent(reference));
    assert.ok(await exists(target), `${relativePath} references missing asset: ${reference}`);
  }
}

for (const relativePath of productionFiles.filter(path => /\.(?:html|js|css)$/.test(path))) {
  const source = await readFile(resolve(root, relativePath), 'utf8');
  const longestLine = source.split(/\r?\n/).reduce((max, line) => Math.max(max, line.length), 0);
  assert.ok(longestLine < 100_000, `${relativePath} contains a text line over 100KB`);
}

console.log('static structure: file budgets, lazy boundaries, and local assets passed');
