// Run against scripts/dev-server.mjs with Playwright available in the environment:
// node tests/browser/post-sharing.cjs
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const fixture = `
const post = { title: '공유 테스트 공략', body: '<p>공략 본문</p>', category: 'guide-dive', authorName: '작성자', authorEmail: 'writer@example.com' };
const item = { id: 'sample-post', exists: () => true, data: () => post };
const sdk = {
  onAuthStateChanged: (auth, callback) => { queueMicrotask(() => callback(null)); return () => {}; },
  doc: (db, ...path) => path,
  collection: (db, name) => name,
  where: (...args) => args, orderBy: () => null, limit: () => null,
  query: (...args) => args,
  getDocs: async query => ({ forEach: callback => {
    if (query[0] === 'posts' && (!query[1] || query[1][1] !== 'in' || query[1][2].includes(post.category))) callback(item);
  } }),
  getDoc: async path => {
    if (path[1] === 'slow') { window.slowPostStarted = true; await new Promise(resolve => window.resolveSlowPost = resolve); return item; }
    if (path[1] === 'failure') throw new Error('Offline fixture');
    return path[1] === item.id ? item : { exists: () => false };
  },
};
export const ensureAuth = async () => ({ auth: {}, sdk });
export const ensureFirestore = async () => ({ db: {}, sdk });
export const ensureBoardServices = ensureFirestore;
export const ensureStorage = async () => { throw new Error('Not used'); };
`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext();
    await context.route('**/js/firebase-client.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
    await context.route('https://**/*', route => route.abort());
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedLink = text; } } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = process.env.GUIDE_TEST_URL || 'http://127.0.0.1:8080/';
    await page.goto(base + '#guide-dive');
    await page.locator('[data-board-action="open"]').first().click();
    await page.locator('[data-board-action="share"]').click();
    const link = await page.evaluate(() => window.copiedLink);
    assert.equal(link, base + '#guide-all?post=sample-post');
    await page.goto(link);
    await page.locator('#postModal.show').waitFor();
    assert.equal(await page.locator('#postModalTitle').textContent(), '공유 테스트 공략');
    await page.reload();
    await page.locator('#postModal.show').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(new URL(page.url()).hash, '#guide-all');
    await page.reload();
    await page.locator('#guideHubList .post-card').first().waitFor();
    assert.equal(await page.locator('#postModal').getAttribute('aria-hidden'), 'true');
    await page.evaluate(() => { location.hash = 'guide-all?post=sample-post'; });
    await page.locator('#postModal.show').waitFor();
    await page.goBack();
    await page.waitForFunction(() => document.getElementById('postModal').getAttribute('aria-hidden') === 'true');
    await page.goForward();
    await page.locator('#postModal.show').waitFor();
    await page.goto(base + '#guide-all?post=missing');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('글을 찾을 수'));
    assert.equal(await page.locator('#postModal').getAttribute('aria-hidden'), 'true');
    await page.goto(base + '#guide-all?post=failure');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('불러오지 못'));
    await page.goto(base + '#guide-all?post=slow');
    await page.waitForFunction(() => window.slowPostStarted);
    await page.evaluate(() => { location.hash = 'guide-dive'; });
    await page.locator('#view-guide.active').waitFor();
    await page.evaluate(async () => { window.resolveSlowPost(); await new Promise(resolve => setTimeout(resolve, 50)); });
    assert.equal(await page.locator('#postModal').getAttribute('aria-hidden'), 'true');
    assert.deepEqual(errors, []);
    console.log('Post sharing browser checks passed: copy, direct link, reload, close, back/forward, missing post, network failure, stale request. Firebase is mocked; no production writes.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
