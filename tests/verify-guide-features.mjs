import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [html, app, board, admin, rules] = await Promise.all([
  readFile(resolve(root, 'index.html'), 'utf8'),
  readFile(resolve(root, 'js/app.js'), 'utf8'),
  readFile(resolve(root, 'js/board.js'), 'utf8'),
  readFile(resolve(root, 'js/admin-panel.js'), 'utf8'),
  readFile(resolve(root, 'firestore.rules.example'), 'utf8'),
]);

for (const label of ['홈', '공식홈피', '가이드', '계산기 도구', '건의게시판']) assert.match(html, new RegExp(`>${label}(?:\\s|<)`), `top navigation is missing ${label}`);
assert.match(html, /id="primaryNav"[^>]+aria-label="주요 메뉴"/, 'primary navigation is not labelled');
assert.match(html, /class="[^"]*nav-menu-trigger[^"]*"[^>]+aria-expanded="false"/, 'dropdown trigger state is missing');
assert.match(html, /target="_blank" rel="noopener noreferrer"/, 'official site link is not protected');
const navOrder = ['>홈<', '>공식홈피 ', '>가이드 ', '>계산기 도구 ', '>건의게시판<', '>운영진<'].map(needle => html.indexOf(needle));
assert.ok(navOrder.every((offset, index) => offset >= 0 && (index === 0 || offset > navOrder[index - 1])), 'top navigation order is incorrect');
assert.match(html, /id="adminNavItem"[^>]+data-page="admin"[^>]+hidden/, 'admin navigation must start hidden');
assert.match(html, /id="view-admin"[\s\S]*id="adminApp" hidden/, 'admin component must live in the main SPA and stay hidden until authorized');
assert.doesNotMatch(html, /admin\.html|css\/admin\.css|js\/admin\.js/, 'standalone admin page dependency remains');
assert.match(app, /export const GUIDE_HUBS/, 'guide hub routing metadata is missing');
assert.match(app, /import\('\.\/admin-panel\.js'\)/, 'admin component is not lazy loaded');
assert.match(app, /page === 'admin'/, 'admin hash route is missing');
assert.match(app, /brick-auth-change[\s\S]*accessWasRevoked[\s\S]*navigate\('home'\)/, 'admin route is not closed when permission is revoked');
assert.match(board, /post\.indexId === indexId/, 'guide filtering does not use scalar indexId');
assert.match(board, /sdk\.where\('category', 'in', categoryChunk\)/, 'guide hub must not download unrelated board posts');
assert.doesNotMatch(admin, /indexIds|arrayUnion/, 'admin classification must not store multiple indexes');
assert.match(admin, /sdk\.where\('category', 'in', categoryChunk\)/, 'admin panel must load only guide posts');
assert.match(admin, /const indexId = select\.value \|\| null/, 'admin assignment must persist one scalar indexId or null');
assert.match(board, /sdk\.runTransaction\(db/, 'like toggle must use a Firestore transaction');
assert.match(board, /'posts', postId, 'likes', currentUser\.uid/, 'like document is not keyed by the user UID');
assert.match(board, /transaction\.get\(postRef\)[\s\S]*transaction\.get\(likeRef\)/, 'transaction must read post and like before writes');
assert.match(board, /cachedPost\.likeCount = result\.count[\s\S]*renderGuideHub\(\)/, 'like result does not refresh the guide hub count and sorting');
assert.match(html, /class="like-btn"|id="postModalActions"/, 'post detail action host is missing');
assert.match(board, /data\(\)\?\.role === 'admin'/, 'admin role is not verified from users UID document');
assert.match(board, /adminNavItem\.hidden = !isAdmin/, 'admin navigation visibility is not role-gated');
assert.match(board, /roleUnsubscribe\?\.\(\)[\s\S]*isAdmin = false;[\s\S]*updateAuthUI\(\)[\s\S]*await checkAdmin\(user\)/, 'auth changes must revoke stale admin UI before the next role lookup');
assert.match(board, /stateToken !== authStateToken/, 'stale async admin role lookups are not discarded');
assert.match(board, /if \(token !== roleWatchToken[\s\S]*isAdmin = false;[\s\S]*updateAuthUI\(\)/, 'role listener errors must fail closed');
assert.match(rules, /existsAfter\(likePath\(postId\)\)/, 'rules example does not tie count updates to like writes');
assert.match(rules, /indexId is string[\s\S]*documents\/guideIndexes\/\$\(indexId\)/, 'rules example does not enforce one valid scalar indexId');
assert.match(rules, /allow list: if false/, 'like documents must not expose a public UID listing');
assert.doesNotMatch(html, /class="sidebar"/, 'legacy sidebar remains in the page');

console.log('guide features: navigation, scalar index, admin gating, and UID likes passed');
