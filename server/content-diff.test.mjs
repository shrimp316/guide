import assert from 'node:assert/strict';
import test from 'node:test';
import { addedText, contentHash, extractLatestVersion, normalizeContent, stablePostId } from './content-diff.js';

test('content normalization makes formatting-only changes stable', () => {
  assert.equal(normalizeContent('  A  \r\n B  '), 'A\nB');
  assert.equal(contentHash('A  B'), contentHash('A B'));
  assert.equal(stablePostId('https://example.com').length, 32);
});

test('added text contains only newly introduced lines', () => {
  assert.equal(addedText('A\nB', 'A\nB\nC'), 'C');
  assert.equal(addedText('A\nB', 'A'), '');
});

test('latest labelled patch version wins regardless of document order', () => {
  const content = 'Version 2.2.5\n2026.02.26\nVersion 2.2.6\nVersion 2.1.9';
  assert.equal(extractLatestVersion(content), '2.2.6');
  assert.equal(extractLatestVersion('버전 2.3.8\n버전 2.3.10'), '2.3.10');
});

test('bare semantic versions are supported while calendar dates are ignored', () => {
  assert.equal(extractLatestVersion('게시일 2026.02.26\n패치 2.4.7\n이전 2.4.6'), '2.4.7');
  assert.equal(extractLatestVersion('게시일 2026.02.26'), null);
});
