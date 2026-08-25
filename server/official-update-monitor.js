import * as cheerio from 'cheerio';
import { createPrivateKey } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { addedText, contentHash, extractLatestVersion, normalizeContent, stablePostId } from './content-diff.js';

const BLOG_URL = 'https://www.seasoninggames.com/ko/blog';
const BLOG_FEED_URL = 'https://www.seasoninggames.com/blog-feed.xml';
const OFFICIAL_ORIGIN = new URL(BLOG_URL).origin;
const FETCH_TIMEOUT_MS = 20_000;
const RUN_LEASE_MS = 5 * 60_000;
const MAX_CONTENT_LENGTH = 500_000;
const MIN_CONTENT_LENGTH = 80;
const PUBLIC_CHANGE_TEXT_LIMIT = 600;

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

class PrivateKeyConfigurationError extends Error {
  constructor(reason) {
    super(`Firebase private key configuration is invalid (${reason})`);
    this.name = 'PrivateKeyConfigurationError';
    this.code = 'firebase-private-key-invalid';
    this.safeDetail = `firebase-private-key:${reason}`;
  }
}

export function normalizePrivateKey(value) {
  if (typeof value !== 'string' || !value.trim()) throw new PrivateKeyConfigurationError('empty');
  const trimmed = value.replace(/^\uFEFF/, '').trim();
  let unquoted = trimmed;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      unquoted = JSON.parse(trimmed);
    } catch {
      unquoted = trimmed.slice(1, -1);
    }
  } else if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    unquoted = trimmed.slice(1, -1);
  }
  if (typeof unquoted !== 'string') throw new PrivateKeyConfigurationError('json-object-not-supported');
  let candidate = unquoted.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').trim();

  if (!candidate.includes('-----BEGIN ') && /^[A-Za-z0-9+/=\s]+$/.test(candidate)) {
    try {
      const decoded = Buffer.from(candidate.replace(/\s/g, ''), 'base64').toString('utf8').trim();
      if (decoded.startsWith('-----BEGIN ')) candidate = decoded.replace(/\r\n?/g, '\n');
    } catch {
      // Shape validation below returns a stable, non-secret diagnostic.
    }
  }

  const begin = '-----BEGIN PRIVATE KEY-----';
  const end = '-----END PRIVATE KEY-----';
  const beginIndex = candidate.indexOf(begin);
  const endIndex = candidate.indexOf(end);
  if (beginIndex < 0) throw new PrivateKeyConfigurationError('missing-pkcs8-header');
  if (endIndex < 0 || endIndex < beginIndex) throw new PrivateKeyConfigurationError('missing-pkcs8-footer');
  if (candidate.slice(0, beginIndex).trim() || candidate.slice(endIndex + end.length).trim()) {
    throw new PrivateKeyConfigurationError('unexpected-wrapper-text');
  }
  const body = candidate.slice(beginIndex + begin.length, endIndex).replace(/\s/g, '');
  if (!body || !/^[A-Za-z0-9+/]+={0,2}$/.test(body) || body.length % 4 !== 0) {
    throw new PrivateKeyConfigurationError('invalid-base64-body');
  }
  const normalized = `${begin}\n${body.match(/.{1,64}/g).join('\n')}\n${end}\n`;
  try {
    createPrivateKey({ key: normalized, format: 'pem' });
  } catch {
    throw new PrivateKeyConfigurationError('crypto-parse-failed');
  }
  return normalized;
}

function createDatabase() {
  const projectId = requiredEnvironment('FIREBASE_PROJECT_ID');
  const clientEmail = requiredEnvironment('FIREBASE_CLIENT_EMAIL');
  const privateKey = normalizePrivateKey(requiredEnvironment('FIREBASE_PRIVATE_KEY'));
  let credential;
  try {
    credential = cert({ projectId, clientEmail, privateKey });
  } catch {
    throw new PrivateKeyConfigurationError('credential-rejected');
  }
  const app = getApps()[0] || initializeApp({ credential, projectId });
  return getFirestore(app);
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/rss+xml,application/xml;q=0.9,text/html;q=0.8,application/xhtml+xml;q=0.8',
      'user-agent': 'BrickIncGuide-OfficialUpdateMonitor/1.0',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Official site returned HTTP ${response.status}`);
  return response.text();
}

function normalizePostUrl(href) {
  try {
    const url = new URL(href, BLOG_URL);
    const prefix = '/ko/post/';
    if (url.origin !== OFFICIAL_ORIGIN || !url.pathname.startsWith(prefix) || !url.pathname.slice(prefix.length).replace(/\/+$/, '')) return null;
    url.hash = '';
    url.search = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function findArticleSchema(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findArticleSchema(item);
      if (match) return match;
    }
    return null;
  }
  const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
  if (types.some(type => ['Article', 'BlogPosting', 'NewsArticle'].includes(type)) && value.articleBody) return value;
  for (const nested of Object.values(value)) {
    const match = findArticleSchema(nested);
    if (match) return match;
  }
  return null;
}

function extractSchema($) {
  let article = null;
  $('script[type="application/ld+json"]').each((_, element) => {
    if (article) return;
    try {
      article = findArticleSchema(JSON.parse($(element).text()));
    } catch {
      // Ignore unrelated or malformed structured data and continue with DOM extraction.
    }
  });
  return article;
}

function extractDomContent($) {
  const source = $('[data-hook="post-content"]').first().length
    ? $('[data-hook="post-content"]').first()
    : $('[data-hook="post-page"]').first().length
      ? $('[data-hook="post-page"]').first()
      : $('article').first().length
        ? $('article').first()
        : $('main').first();
  const clone = source.clone();
  clone.find('script,style,noscript,svg,nav,footer,form,button').remove();
  clone.find('p,li,h1,h2,h3,h4,blockquote,br').each((_, element) => $(element).append('\n'));
  return clone.text();
}

export function parseBlogFeed(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const posts = new Map();
  $('item').each((_, item) => {
    const entry = $(item);
    const url = normalizePostUrl(entry.find('link').first().text());
    if (!url) return;
    posts.set(url, {
      url,
      title: normalizeContent(entry.find('title').first().text()),
      description: normalizeContent(entry.find('description').first().text()),
      guid: normalizeContent(entry.find('guid').first().text()),
      publishedAt: normalizeContent(entry.find('pubDate').first().text()),
    });
  });
  return [...posts.values()];
}

export function parsePostPage(html, fallbackTitle, url) {
  const $ = cheerio.load(html);
  const schema = extractSchema($);
  const title = normalizeContent(
    schema?.headline
      || $('[data-hook="post-title"]').first().text()
      || $('article h1').first().text()
      || $('main h1').first().text()
      || $('meta[property="og:title"]').attr('content')
      || fallbackTitle,
  );
  const content = normalizeContent(schema?.articleBody || extractDomContent($));
  if (!title || content.length < MIN_CONTENT_LENGTH) throw new Error(`Could not extract complete official post content: ${url}`);
  const storedContent = content.slice(0, MAX_CONTENT_LENGTH);
  return {
    title,
    url,
    content: storedContent,
    hash: contentHash(storedContent),
    latestVersion: extractLatestVersion(storedContent),
  };
}

async function fetchPosts(listing) {
  const results = [];
  const failures = [];
  const queue = [...listing];
  const worker = async () => {
    while (queue.length) {
      const entry = queue.shift();
      try {
        results.push(parsePostPage(await fetchHtml(entry.url), entry.title, entry.url));
      } catch (error) {
        failures.push({ url: entry.url, message: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return { results, failures };
}

async function includeTrackedPosts(db, listing) {
  const posts = new Map(listing.map(post => [post.url, post]));
  const snapshot = await db.collection('officialPosts').select('title', 'url').get();
  snapshot.forEach(document => {
    const data = document.data();
    const url = normalizePostUrl(data.url);
    if (url && !posts.has(url)) posts.set(url, { url, title: normalizeContent(data.title) });
  });
  return [...posts.values()];
}

async function acquireLease(db) {
  const stateRef = db.collection('officialUpdateMonitor').doc('state');
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(stateRef);
    const state = snapshot.data() || {};
    const now = Date.now();
    if (state.runningUntil?.toMillis?.() > now) return { acquired: false, baseline: false, stateRef };
    transaction.set(stateRef, {
      runningUntil: Timestamp.fromMillis(now + RUN_LEASE_MS),
      lastStartedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { acquired: true, baseline: state.initialized !== true, stateRef };
  });
}

async function savePost(db, post, baseline) {
  const postId = stablePostId(post.url);
  const postRef = db.collection('officialPosts').doc(postId);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(postRef);
    if (!snapshot.exists) {
      const revision = 1;
      const versionRef = postRef.collection('versions').doc(String(revision).padStart(8, '0'));
      transaction.create(postRef, {
        title: post.title,
        url: post.url,
        lastContentHash: post.hash,
        latestVersion: post.latestVersion,
        revision,
        lastCheckedAt: FieldValue.serverTimestamp(),
        lastChangedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(versionRef, {
        content: post.content,
        contentHash: post.hash,
        latestVersion: post.latestVersion,
        revision,
        capturedAt: FieldValue.serverTimestamp(),
      });
      if (!baseline) {
        const changeRef = db.collection('officialPostChanges').doc(`${postId}_${String(revision).padStart(8, '0')}`);
        transaction.create(changeRef, {
          postId,
          title: post.title,
          url: post.url,
          changeType: 'new',
          addedText: post.content.slice(0, PUBLIC_CHANGE_TEXT_LIMIT),
          latestVersion: post.latestVersion,
          revision,
          detectedAt: FieldValue.serverTimestamp(),
          notificationSent: false,
        });
      }
      return baseline ? 'baseline' : 'new';
    }

    const previous = snapshot.data();
    if (previous.lastContentHash === post.hash) {
      transaction.update(postRef, {
        title: post.title,
        url: post.url,
        latestVersion: post.latestVersion,
        lastCheckedAt: FieldValue.serverTimestamp(),
      });
      return 'unchanged';
    }

    const previousRevision = Math.max(1, Number(previous.revision) || 1);
    const previousRef = postRef.collection('versions').doc(String(previousRevision).padStart(8, '0'));
    const previousSnapshot = await transaction.get(previousRef);
    const nextRevision = previousRevision + 1;
    const nextRef = postRef.collection('versions').doc(String(nextRevision).padStart(8, '0'));
    transaction.update(postRef, {
      title: post.title,
      url: post.url,
      lastContentHash: post.hash,
      latestVersion: post.latestVersion,
      revision: nextRevision,
      lastCheckedAt: FieldValue.serverTimestamp(),
      lastChangedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(nextRef, {
      content: post.content,
      contentHash: post.hash,
      latestVersion: post.latestVersion,
      revision: nextRevision,
      capturedAt: FieldValue.serverTimestamp(),
    });
    if (!baseline) {
      const changeRef = db.collection('officialPostChanges').doc(`${postId}_${String(nextRevision).padStart(8, '0')}`);
      transaction.create(changeRef, {
        postId,
        title: post.title,
        url: post.url,
        changeType: 'edited',
        addedText: addedText(previousSnapshot.data()?.content || '', post.content, PUBLIC_CHANGE_TEXT_LIMIT),
        latestVersion: post.latestVersion,
        revision: nextRevision,
        detectedAt: FieldValue.serverTimestamp(),
        notificationSent: false,
      });
    }
    return baseline ? 'baseline' : 'updated';
  });
}

async function announceVersionOnce(db, posts, version) {
  if (!version) return null;
  const post = posts.find(item => item.latestVersion === version);
  if (!post) throw new Error(`Official version ${version} was not found in the monitored posts`);

  const postId = stablePostId(post.url);
  const postSnapshot = await db.collection('officialPosts').doc(postId).get();
  if (!postSnapshot.exists) throw new Error(`Official post was not stored before announcing version ${version}`);

  const changeId = `${postId}_manual_${version.replaceAll('.', '_')}`;
  const changeRef = db.collection('officialPostChanges').doc(changeId);
  try {
    await changeRef.create({
      postId,
      title: post.title,
      url: post.url,
      changeType: 'edited',
      addedText: `Version ${version} 업데이트 노트가 공개되었습니다.`,
      latestVersion: version,
      revision: Number(postSnapshot.data()?.revision) || 1,
      detectedAt: FieldValue.serverTimestamp(),
      notificationSent: false,
      manual: true,
    });
    return { version, created: true, changeId };
  } catch (error) {
    if (error?.code === 6 || error?.code === 'already-exists') {
      return { version, created: false, changeId };
    }
    throw error;
  }
}

export async function checkOfficialUpdates({ announceVersion } = {}) {
  const db = createDatabase();
  const lease = await acquireLease(db);
  if (!lease.acquired) return { ok: true, skipped: true, reason: 'already-running' };

  try {
    const listing = parseBlogFeed(await fetchHtml(BLOG_FEED_URL));
    if (!listing.length) throw new Error('No Korean official blog posts were found');
    const fetched = await fetchPosts(await includeTrackedPosts(db, listing));
    const summary = { baseline: lease.baseline, checked: 0, unchanged: 0, new: 0, updated: 0, failed: fetched.failures.length };
    if (lease.baseline && fetched.failures.length) throw new Error('Baseline aborted because one or more official posts could not be fetched');
    for (const post of fetched.results) {
      const outcome = await savePost(db, post, lease.baseline);
      summary.checked += 1;
      if (outcome === 'baseline') summary.unchanged += 1;
      else summary[outcome] += 1;
    }
    const announcement = await announceVersionOnce(db, fetched.results, announceVersion);
    await lease.stateRef.set({
      initialized: true,
      runningUntil: Timestamp.fromMillis(0),
      lastCompletedAt: FieldValue.serverTimestamp(),
      lastRunSummary: summary,
    }, { merge: true });
    return { ok: true, ...summary, announcement, failures: fetched.failures };
  } catch (error) {
    await lease.stateRef.set({
      runningUntil: Timestamp.fromMillis(0),
      lastErrorAt: FieldValue.serverTimestamp(),
      lastError: String(error instanceof Error ? error.message : error).slice(0, 500),
    }, { merge: true });
    throw error;
  }
}
