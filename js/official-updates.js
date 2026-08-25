import { ensureFirestore } from './firebase-client.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDetectedAt(value) {
  const date = value?.toDate?.();
  return date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('ko-KR')
    : '감지 시간 없음';
}

function describeChange(change) {
  if (change.addedText) return change.addedText;
  if (change.latestVersion) return `${change.latestVersion} 내용이 추가되었습니다.`;
  return change.changeType === 'new'
    ? '새 공식 게시글이 등록되었습니다.'
    : '공식 게시글 내용이 변경되었습니다.';
}

export async function loadOfficialUpdates() {
  const container = document.getElementById('officialUpdatesPreview');
  if (!container) return;

  container.setAttribute('aria-busy', 'true');
  try {
    const { db, sdk } = await ensureFirestore();
    const updatesQuery = sdk.query(
      sdk.collection(db, 'officialPostChanges'),
      sdk.orderBy('detectedAt', 'desc'),
      sdk.limit(5),
    );
    const snapshot = await sdk.getDocs(updatesQuery);
    const changes = [];
    snapshot.forEach(item => changes.push({ id: item.id, ...item.data() }));

    if (!changes.length) {
      container.innerHTML = '<p class="dashboard-empty">아직 감지된 공식 업데이트가 없습니다.</p>';
      return;
    }

    container.innerHTML = changes.map(change => {
      const typeLabel = change.changeType === 'new' ? '신규' : '수정';
      const safeUrl = typeof change.url === 'string' && /^https:\/\/www\.seasoninggames\.com\//.test(change.url)
        ? change.url
        : 'https://www.seasoninggames.com/ko/blog';
      return `<a class="official-update-item" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">
        <span class="official-update-type official-update-type-${change.changeType === 'new' ? 'new' : 'edited'}">${typeLabel}</span>
        <span class="latest-post-copy">
          <strong>${escapeHtml(change.title || '공식 업데이트')}</strong>
          <small>${escapeHtml(describeChange(change))} · ${escapeHtml(formatDetectedAt(change.detectedAt))}</small>
        </span>
        <span class="latest-post-arrow" aria-hidden="true">↗</span>
      </a>`;
    }).join('');
  } catch (error) {
    console.error('공식 소식 불러오기 실패:', error);
    container.innerHTML = '<p class="dashboard-empty dashboard-empty-error">공식 소식을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.</p>';
  } finally {
    container.setAttribute('aria-busy', 'false');
  }
}
