import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [html, css, app, board] = await Promise.all([
  readFile(resolve(root, 'index.html'), 'utf8'),
  readFile(resolve(root, 'css/index.css'), 'utf8'),
  readFile(resolve(root, 'js/app.js'), 'utf8'),
  readFile(resolve(root, 'js/board.js'), 'utf8'),
]);

for (const duplicateGrid of ['grid-pin', 'grid-guide', 'grid-strategy', 'grid-cal', 'grid-tool', 'grid-community']) {
  assert.doesNotMatch(html, new RegExp(`id=["']${duplicateGrid}["']`), `${duplicateGrid} still duplicates the sidebar on home`);
}

assert.equal((html.match(/<h1\b/gi) || []).length, 1, 'home must have one primary h1');
assert.match(html, /<h1\s+id="homeTitle">[^<]+<\/h1>/, 'home hero heading is missing');
assert.doesNotMatch(html, /id="updatesTitle"|id="updateList"|최근 업데이트/, 'recent updates section still exists');
assert.match(html, /id="quickTitle"/, 'quick actions section is missing');
assert.match(html, /id="latestPostsTitle"/, 'latest posts preview section is missing');
assert.equal((html.match(/class="quick-action"/g) || []).length, 6, 'home must expose exactly six quick actions');
for (const page of ['calc-ascension', 'calc-dimension-ev', 'calc-forge', 'calc-beast-cal', 'tool-path', 'tool-tree']) {
  assert.match(html, new RegExp(`class="quick-action"[^>]+data-page="${page}"`), `${page} quick action is missing`);
}
for (const page of ['guide-dimension-train', 'guide-amounts']) {
  assert.match(html, new RegExp(`class="nav-item"[^>]+data-page="${page}"`), `${page} remote navigation entry was lost during integration`);
  assert.match(app, new RegExp(`['"]${page}['"]\\s*:`), `${page} guide metadata was lost during integration`);
}
assert.match(html, /id="searchInput"[^>]+aria-controls="searchResults"/, 'integrated search is not connected to its results');

assert.doesNotMatch(app, /home-updates\.json|renderUpdates|loadUpdates/, 'recent update loading code still exists');
assert.match(app, /IntersectionObserver/, 'board preview is not deferred until its section approaches the viewport');
assert.match(app, /!isPageActive\(['"]home['"]\)/, 'board preview can load after leaving the home page');
assert.match(app, /requestIdleCallback/, 'board preview lacks a deferred fallback for older browsers');
assert.match(app, /loadHomePreview\(\)/, 'home does not request the lazy board preview');
assert.doesNotMatch(app, /^import[^\n]+board\.js/m, 'board module is eagerly imported by app.js');
const homePreviewSource = board.slice(
  board.indexOf('export async function loadHomePreview()'),
  board.indexOf('async function getPost('),
);
assert.ok(homePreviewSource, 'latest posts preview implementation is missing');
assert.doesNotMatch(homePreviewSource, /sdk\.where\(/, 'latest posts preview must not filter to one board');
assert.match(homePreviewSource, /sdk\.orderBy\(['"]createdAt['"],\s*['"]desc['"]\)/, 'latest posts must be ordered newest first');
assert.match(homePreviewSource, /sdk\.limit\(3\)/, 'latest posts preview must limit Firestore results to three');
assert.match(homePreviewSource, /GUIDES\[post\.category\]\s*\?\s*post\.category\s*:\s*['"]board-suggest['"]/, 'unknown post categories need a safe route fallback');
assert.match(homePreviewSource, /아직 등록된 글이 없습니다/, 'empty latest-post fallback is missing');
assert.match(homePreviewSource, /최신 글을 불러오지 못했습니다/, 'latest-post error fallback is missing');

for (const width of [900, 720, 480, 360]) {
  assert.match(css, new RegExp(`@media\\(max-width:${width}px\\)`), `${width}px responsive rule is missing`);
}
assert.match(css, /@media\(prefers-reduced-motion:reduce\)/, 'home reduced-motion override is missing');
assert.match(css, /\.hero-bricks span\{animation:none\}/, 'hero animation is not disabled for reduced motion');

console.log('home dashboard: structure, lazy data, fallbacks, and responsive rules passed');
