import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePrivateKey, parseBlogFeed, parsePostPage } from './official-update-monitor.js';

test('RSS feed keeps canonical Korean post links and rejects the post hub', () => {
  const posts = parseBlogFeed(`
    <rss><channel>
      <item>
        <title><![CDATA[2.5 업데이트 패치 노트]]></title>
        <link>https://www.seasoninggames.com/ko/post/2-5-update-patch-note</link>
        <guid>post-guid</guid>
        <description><![CDATA[Version 2.5 업데이트 안내...]]></description>
        <pubDate>Tue, 25 Aug 2026 00:00:00 GMT</pubDate>
      </item>
      <item><title>게시글 허브</title><link>https://www.seasoninggames.com/ko/post/</link></item>
      <item><title>영문 글</title><link>https://www.seasoninggames.com/post/english</link></item>
    </channel></rss>
  `);

  assert.deepEqual(posts, [{
    url: 'https://www.seasoninggames.com/ko/post/2-5-update-patch-note',
    title: '2.5 업데이트 패치 노트',
    description: 'Version 2.5 업데이트 안내...',
    guid: 'post-guid',
    publishedAt: 'Tue, 25 Aug 2026 00:00:00 GMT',
  }]);
});

test('post parser prefers structured article content and extracts the patch version', () => {
  const post = parsePostPage(`
    <html><head>
      <script type="application/ld+json">
        {"@type":"BlogPosting","headline":"2.2 업데이트 패치 노트","articleBody":"Version 2.2.5\\n기존 업데이트 안내와 여러 밸런스 조정 내용이 포함되어 있습니다.\\nVersion 2.2.6\\n새로운 콘텐츠와 개선 사항, 버그 수정 내용이 추가되었습니다."}
      </script>
    </head><body><main>동적 화면 문구</main></body></html>
  `, '대체 제목', 'https://www.seasoninggames.com/ko/post/2-2-update');

  assert.equal(post.title, '2.2 업데이트 패치 노트');
  assert.equal(post.latestVersion, '2.2.6');
  assert.match(post.content, /새로운 콘텐츠와 개선 사항/);
  assert.equal(post.hash.length, 64);
});

test('post parser accepts a rendered Wix post page and rejects a short shell', () => {
  const url = 'https://www.seasoninggames.com/ko/post/2-5-update-patch-note';
  const rendered = parsePostPage(`
    <main data-hook="post-page">
      <h1 data-hook="post-title">2.5 업데이트 패치 노트</h1>
      <p>이번 업데이트에서는 안정적인 서비스를 위한 시스템 개선 작업을 진행했습니다.</p>
      <h2>Version 2.5.8</h2>
      <p>신규 콘텐츠와 밸런스 변경, 최적화 및 다양한 버그 수정 사항이 추가되었습니다.</p>
    </main>
  `, '대체 제목', url);
  assert.equal(rendered.title, '2.5 업데이트 패치 노트');
  assert.equal(rendered.latestVersion, '2.5.8');
  assert.throws(
    () => parsePostPage('<main data-hook="post-page">공통 화면을 불러오는 중입니다.</main>', '대체 제목', url),
    /Could not extract complete official post content/,
  );
});

test('private key normalization accepts Vercel text and JSON-string formats', () => {
  const expected = '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----';
  assert.equal(normalizePrivateKey(expected), expected);
  assert.equal(normalizePrivateKey(expected.replaceAll('\n', '\\n')), expected);
  assert.equal(normalizePrivateKey(JSON.stringify(expected)), expected);
});
