import assert from 'node:assert/strict';
import { buildPostLink, copyPostLink, parsePostRoute } from '../js/post-links.js';

const postId = '공략 &?+#42';
const link = buildPostLink('https://guide.example/sub/?tracking=1#guide-dive', postId);
assert.equal(new URL(link).pathname, '/sub/');
assert.equal(new URL(link).search, '');
assert.deepEqual(parsePostRoute(new URL(link).hash), { page: 'guide-all', postId });
assert.deepEqual(parsePostRoute('#guide-dive'), { page: 'guide-dive', postId: null });
assert.deepEqual(parsePostRoute(''), { page: 'home', postId: null });
assert.equal(parsePostRoute('#guide-all?post=a%2Fb').postId, null);
assert.equal(parsePostRoute('#guide-all?post=').postId, null);

let copied;
let fallback;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  clipboard: { writeText: async value => { copied = value; } },
} });
globalThis.window = { prompt: (message, value) => { fallback = value; } };
assert.equal(await copyPostLink(link), true);
assert.equal(copied, link);
assert.equal(fallback, undefined);
navigator.clipboard.writeText = async () => { throw new Error('Permission denied'); };
assert.equal(await copyPostLink(link), false);
assert.equal(fallback, link);
delete navigator.clipboard;
fallback = undefined;
assert.equal(await copyPostLink(link), false);
assert.equal(fallback, link);
console.log('Post links: route roundtrip, invalid IDs, clipboard and manual fallback passed');
