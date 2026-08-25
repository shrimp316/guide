import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [html, app, client, admin, rules, api, monitor, vercel] = await Promise.all([
  readFile(resolve(root, 'index.html'), 'utf8'),
  readFile(resolve(root, 'js/app.js'), 'utf8'),
  readFile(resolve(root, 'js/official-updates.js'), 'utf8'),
  readFile(resolve(root, 'js/admin-panel.js'), 'utf8'),
  readFile(resolve(root, 'firestore.rules.example'), 'utf8'),
  readFile(resolve(root, 'api/check-official-updates.js'), 'utf8'),
  readFile(resolve(root, 'server/official-update-monitor.js'), 'utf8'),
  readFile(resolve(root, 'vercel.json'), 'utf8'),
]);

assert.match(html, /id="officialUpdatesPreview"[^>]+aria-busy="true"/, 'home official news region is missing');
assert.match(html, /id="officialMonitorList"/, 'staff monitor region is missing');
assert.match(app, /import\('\.\/official-updates\.js'\)/, 'official news module must be lazy loaded');
assert.match(client, /collection\(db, 'officialPostChanges'\)/, 'official changes collection is not queried');
assert.match(client, /orderBy\('detectedAt', 'desc'\)/, 'official changes are not newest-first');
assert.match(admin, /collection\(db, 'officialPosts'\)/, 'staff monitor does not query official post status');

for (const collectionName of ['officialPosts', 'officialPostChanges']) {
  assert.match(rules, new RegExp(`match /${collectionName}/\\{[^}]+\\}[\\s\\S]*?allow read: if true;[\\s\\S]*?allow create, update, delete: if false;`), `${collectionName} rules are unsafe or missing`);
}

assert.match(api, /timingSafeEqual/, 'cron secret comparison must be timing safe');
assert.match(api, /process\.env\.CRON_SECRET/, 'cron endpoint does not require CRON_SECRET');
for (const name of ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']) {
  assert.ok(monitor.includes(`requiredEnvironment('${name}')`), `${name} is not required by the server`);
}
assert.match(monitor, /changeType: 'new'/, 'new-post change documents are missing');
assert.match(monitor, /changeType: 'edited'/, 'edited-post change documents are missing');
assert.match(monitor, /notificationSent: false/, 'notification handoff state is missing');
assert.match(monitor, /baseline: state\.initialized !== true/, 'first-run baseline guard is missing');
assert.match(monitor, /parseBlogFeed\(await fetchHtml\(BLOG_FEED_URL\)\)/, 'canonical RSS links are not used for discovery');
const editedChange = monitor.slice(Math.max(0, monitor.indexOf("changeType: 'edited'") - 600), monitor.indexOf("changeType: 'edited'") + 100);
assert.match(editedChange, /if \(!baseline\)/, 'baseline retries can create edited notifications');
assert.match(monitor, /collection\('officialPosts'\)\.select\('title', 'url'\)/, 'previously tracked posts can fall out of monitoring');
assert.match(monitor, /PUBLIC_CHANGE_TEXT_LIMIT = 600/, 'public change text must remain bounded');

const cron = JSON.parse(vercel);
assert.deepEqual(cron.crons, [{ path: '/api/check-official-updates', schedule: '0 0 * * *' }]);

console.log('official updates: cron security, baseline, Firestore, home, and staff UI passed');
