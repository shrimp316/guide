import { createHash } from 'node:crypto';

export function normalizeContent(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(line => line.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function contentHash(content) {
  return createHash('sha256').update(normalizeContent(content), 'utf8').digest('hex');
}

export function stablePostId(url) {
  return createHash('sha256').update(url, 'utf8').digest('hex').slice(0, 32);
}

function highestVersion(matches) {
  return matches.sort((left, right) => {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
      if (a[index] !== b[index]) return b[index] - a[index];
    }
    return 0;
  })[0] || null;
}

export function extractLatestVersion(content) {
  const text = normalizeContent(content);
  const labelled = [...text.matchAll(/(?:version|버전)\s*[vV]?\s*(\d+\.\d+\.\d+)/gi)].map(match => match[1]);
  if (labelled.length) return highestVersion([...new Set(labelled)]);
  const bare = [...text.matchAll(/(?:^|[^\d.])(\d+\.\d+\.\d+)(?![\d.])/g)]
    .map(match => match[1])
    .filter(version => {
      const major = Number(version.split('.')[0]);
      return major < 1900 || major > 2100;
    });
  return highestVersion([...new Set(bare)]);
}

export function addedText(previousContent, nextContent, maxLength = 40_000) {
  const remaining = new Map();
  for (const line of normalizeContent(previousContent).split('\n').filter(Boolean)) {
    remaining.set(line, (remaining.get(line) || 0) + 1);
  }

  const additions = [];
  for (const line of normalizeContent(nextContent).split('\n').filter(Boolean)) {
    const count = remaining.get(line) || 0;
    if (count > 0) remaining.set(line, count - 1);
    else additions.push(line);
  }
  const result = additions.join('\n');
  return result.length <= maxLength ? result : `${result.slice(0, maxLength)}\n…`;
}
