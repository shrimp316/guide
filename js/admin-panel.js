import { ensureFirestore } from './firebase-client.js';
import { showToast } from './app.js';

const GUIDE_CATEGORIES = new Set([
  'guide-pre-god', 'guide-god1-4', 'guide-god4-7', 'guide-god7-11',
  'guide-god11-15', 'guide-super1-4', 'guide-super4', 'guide-dive',
  'guide-beast-guide', 'guide-dimension-guide', 'guide-dimension-train', 'guide-amounts',
]);
const CATEGORY_NAMES = {
  'guide-pre-god': '신 이전', 'guide-god1-4': '신1 ~ 신4', 'guide-god4-7': '신4 ~ 신7',
  'guide-god7-11': '신7 ~ 신11', 'guide-god11-15': '신11 ~ 신15',
  'guide-super1-4': '초월신1 ~ 4', 'guide-super4': '초월신4 이후',
  'guide-dive': '다이브', 'guide-beast-guide': '신수 공략',
  'guide-dimension-guide': '차원탐사 공략', 'guide-dimension-train': '차원열차 공략',
  'guide-amounts': '수치 정보',
};

let indexes = [];
let posts = [];
let eventsBound = false;
let loadToken = 0;

async function getGuidePosts(db, sdk) {
  const categories = [...GUIDE_CATEGORIES];
  const chunks = [];
  for (let index = 0; index < categories.length; index += 10) {
    chunks.push(categories.slice(index, index + 10));
  }
  const snapshots = await Promise.all(chunks.map(categoryChunk => sdk.getDocs(sdk.query(
    sdk.collection(db, 'posts'),
    sdk.where('category', 'in', categoryChunk),
  ))));
  const result = [];
  snapshots.forEach(snapshot => snapshot.forEach(item => result.push({ id: item.id, ...item.data() })));
  return result;
}

function setStatus(message, error = false) {
  const status = document.getElementById('adminStatus');
  status.textContent = message;
  status.classList.toggle('error', error);
}

function makeButton(label, className, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      console.error('인덱스 관리 실패:', error);
      showToast('요청을 처리하지 못했습니다.');
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function renderIndexes() {
  const list = document.getElementById('indexList');
  list.replaceChildren();
  if (!indexes.length) {
    const empty = document.createElement('p');
    empty.className = 'admin-empty';
    empty.textContent = '등록된 인덱스가 없습니다.';
    list.append(empty);
    return;
  }

  indexes.forEach(index => {
    const row = document.createElement('div');
    row.className = 'index-row';
    const input = document.createElement('input');
    input.value = index.name || '';
    input.maxLength = 30;
    input.setAttribute('aria-label', `${index.name || '인덱스'} 이름`);
    const save = makeButton('이름 저장', 'secondary-btn', async () => {
      const name = input.value.trim();
      if (!name) return showToast('이름을 입력해주세요.');
      const { db, sdk } = await ensureFirestore();
      await sdk.updateDoc(sdk.doc(db, 'guideIndexes', index.id), { name, updatedAt: sdk.serverTimestamp() });
      index.name = name;
      input.setAttribute('aria-label', `${name} 이름`);
      renderPosts();
      showToast('이름을 저장했습니다.');
    });
    const toggle = makeButton(index.active === false ? '활성화' : '비활성화', 'toggle-btn', async () => {
      const active = index.active === false;
      const { db, sdk } = await ensureFirestore();
      await sdk.updateDoc(sdk.doc(db, 'guideIndexes', index.id), { active, updatedAt: sdk.serverTimestamp() });
      index.active = active;
      renderIndexes();
      renderPosts();
      showToast(active ? '인덱스를 활성화했습니다.' : '인덱스를 비활성화했습니다.');
    });
    toggle.setAttribute('aria-pressed', String(index.active !== false));
    row.append(input, save, toggle);
    list.append(row);
  });
}

function renderPosts() {
  const list = document.getElementById('postAssignmentList');
  list.replaceChildren();
  document.getElementById('postCount').textContent = `${posts.length}개`;
  if (!posts.length) {
    const empty = document.createElement('p');
    empty.className = 'admin-empty';
    empty.textContent = '분류할 가이드 글이 없습니다.';
    list.append(empty);
    return;
  }

  posts.forEach(post => {
    const row = document.createElement('div');
    row.className = 'assignment-row';
    const copy = document.createElement('div');
    copy.className = 'post-copy';
    const title = document.createElement('strong');
    title.textContent = post.title || '제목 없음';
    const meta = document.createElement('small');
    meta.textContent = CATEGORY_NAMES[post.category] || post.category;
    copy.append(title, meta);

    const select = document.createElement('select');
    select.setAttribute('aria-label', `${post.title || '제목 없음'} 인덱스`);
    select.append(new Option('미분류', ''));
    indexes
      .filter(index => index.active !== false || index.id === post.indexId)
      .forEach(index => select.append(new Option(`${index.name}${index.active === false ? ' (비활성)' : ''}`, index.id)));
    select.value = typeof post.indexId === 'string' ? post.indexId : '';
    select.addEventListener('change', async () => {
      const previous = post.indexId || '';
      select.disabled = true;
      try {
        const { db, sdk } = await ensureFirestore();
        const indexId = select.value || null;
        await sdk.updateDoc(sdk.doc(db, 'posts', post.id), { indexId, updatedAt: sdk.serverTimestamp() });
        post.indexId = indexId;
        showToast('인덱스를 저장했습니다.');
      } catch (error) {
        console.error('인덱스 저장 실패:', error);
        select.value = previous;
        showToast('인덱스를 저장하지 못했습니다.');
      } finally {
        select.disabled = false;
      }
    });
    row.append(copy, select);
    list.append(row);
  });
}

async function loadData(token) {
  const { db, sdk } = await ensureFirestore();
  const [indexSnapshot, guidePosts] = await Promise.all([
    sdk.getDocs(sdk.collection(db, 'guideIndexes')),
    getGuidePosts(db, sdk),
  ]);
  if (token !== loadToken) return;
  indexes = [];
  indexSnapshot.forEach(item => indexes.push({ id: item.id, ...item.data() }));
  indexes.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || (a.name || '').localeCompare(b.name || '', 'ko'));
  posts = guidePosts;
  posts.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  renderIndexes();
  renderPosts();
}

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;
  document.getElementById('indexCreateForm').addEventListener('submit', async event => {
    event.preventDefault();
    const input = document.getElementById('newIndexName');
    const name = input.value.trim();
    if (!name) return;
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const { db, sdk } = await ensureFirestore();
      const order = indexes.reduce((max, index) => Math.max(max, Number(index.order) || 0), -1) + 1;
      const ref = await sdk.addDoc(sdk.collection(db, 'guideIndexes'), {
        name, active: true, order, createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(),
      });
      indexes.push({ id: ref.id, name, active: true, order });
      input.value = '';
      renderIndexes();
      renderPosts();
      showToast('인덱스를 추가했습니다.');
    } catch (error) {
      console.error('인덱스 추가 실패:', error);
      showToast('인덱스를 추가하지 못했습니다.');
    } finally {
      submit.disabled = false;
    }
  });
}

export function clearAdminPanel(message = '관리자 권한이 필요합니다.') {
  loadToken += 1;
  indexes = [];
  posts = [];
  document.getElementById('adminApp').hidden = true;
  document.getElementById('indexList').replaceChildren();
  document.getElementById('postAssignmentList').replaceChildren();
  setStatus(message, true);
}

export async function loadAdminPanel({ user, isAdmin }) {
  bindEvents();
  if (!user || !isAdmin) {
    clearAdminPanel(user ? '관리자 권한이 없는 계정입니다.' : 'Google 로그인 후 이용할 수 있습니다.');
    return false;
  }
  const token = ++loadToken;
  document.getElementById('adminApp').hidden = true;
  setStatus(`${user.displayName || user.email} 관리자 권한으로 데이터를 불러오는 중입니다.`);
  try {
    await loadData(token);
    if (token !== loadToken) return false;
    setStatus(`${user.displayName || user.email} 관리자로 로그인했습니다.`);
    document.getElementById('adminApp').hidden = false;
    return true;
  } catch (error) {
    console.error('운영진 데이터 로드 실패:', error);
    clearAdminPanel('관리 데이터를 불러오지 못했습니다.');
    return false;
  }
}
