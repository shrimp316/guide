import { ensureAuth, ensureBoardServices, ensureFirestore, ensureStorage } from './firebase-client.js';
import { ensureQuill } from './quill-loader.js';
import {
  GUIDES,
  closeAccessibleModal,
  escHtml,
  getModalTrigger,
  isPageActive,
  openAccessibleModal,
  showToast,
} from './app.js';

const REDIRECT_PENDING_KEY = 'brick-guide:auth-redirect-pending';
let currentUser = null;
let isAdmin = false;
let currentCategory = null;
let authUnsubscribe = null;
let authReadyPromise = null;
let requestToken = 0;
let eventsBound = false;
let quill = null;
const boardLoadPromises = new Map();

async function hashPw(password) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}

function updateAuthUI() {
  const button = document.getElementById('authBtn');
  const userInfo = document.getElementById('userInfo');
  button.textContent = currentUser ? '로그아웃' : 'Google 로그인';
  userInfo.textContent = currentUser?.displayName || currentUser?.email || '';
  userInfo.style.display = currentUser ? 'block' : 'none';
}

async function checkAdmin(user) {
  if (!user || !currentCategory) return false;
  try {
    const { db, sdk } = await ensureFirestore();
    const snapshot = await sdk.getDoc(sdk.doc(db, 'users', user.uid));
    return snapshot.exists() && snapshot.data()?.role === 'admin';
  } catch {
    return false;
  }
}

async function initializeAuth() {
  if (authReadyPromise) return authReadyPromise;
  authReadyPromise = ensureAuth().then(({ auth, sdk }) => new Promise(resolve => {
    let initialState = true;
    authUnsubscribe = sdk.onAuthStateChanged(auth, async user => {
      const previousUserId = currentUser?.uid || null;
      currentUser = user;
      isAdmin = await checkAdmin(user);
      updateAuthUI();
      const shouldRefresh = !initialState && currentCategory && isPageActive(currentCategory)
        && previousUserId !== (user?.uid || null);
      initialState = false;
      if (shouldRefresh) loadBoard(currentCategory);
      resolve({ auth, sdk });
    });
  })).catch(error => {
    authReadyPromise = null;
    throw error;
  });
  return authReadyPromise;
}

export async function resumeRedirectIfPending() {
  if (sessionStorage.getItem(REDIRECT_PENDING_KEY) !== '1') return;
  try {
    const { auth, sdk } = await ensureAuth();
    const result = await sdk.getRedirectResult(auth);
    await initializeAuth();
    if (result?.user) showToast('로그인 완료!');
  } catch (error) {
    if (error?.code !== 'auth/no-auth-event') showToast(`로그인 오류: ${error.message}`);
  } finally {
    sessionStorage.removeItem(REDIRECT_PENDING_KEY);
  }
}

export async function handleAuthButton() {
  try {
    const { auth, provider, sdk } = await ensureAuth();
    await initializeAuth();
    if (currentUser) {
      await sdk.signOut(auth);
      return;
    }
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      sessionStorage.setItem(REDIRECT_PENDING_KEY, '1');
      await sdk.signInWithRedirect(auth, provider);
    } else {
      await sdk.signInWithPopup(auth, provider);
      showToast('로그인 완료!');
    }
  } catch (error) {
    sessionStorage.removeItem(REDIRECT_PENDING_KEY);
    showToast(`로그인 실패: ${error.message}`);
  }
}

function requestIsCurrent(token, category) {
  return token === requestToken && currentCategory === category && isPageActive(category);
}

export function loadBoard(category) {
  const pending = boardLoadPromises.get(category);
  if (pending && currentCategory === category && isPageActive(category)) return pending;
  const task = performBoardLoad(category).finally(() => {
    if (boardLoadPromises.get(category) === task) boardLoadPromises.delete(category);
  });
  boardLoadPromises.set(category, task);
  return task;
}

async function performBoardLoad(category) {
  bindBoardEvents();
  currentCategory = category;
  const token = ++requestToken;
  const meta = GUIDES[category];
  if (!meta) return;

  document.getElementById('guideTitle').textContent = meta.title;
  document.getElementById('guideDesc').textContent = meta.desc;
  document.getElementById('boardList').innerHTML =
    '<p class="board-status">불러오는 중...</p>';

  try {
    const { db, sdk } = await ensureBoardServices();
    await initializeAuth();
    if (!requestIsCurrent(token, category)) return;
    isAdmin = await checkAdmin(currentUser);
    const boardQuery = sdk.query(
      sdk.collection(db, 'posts'),
      sdk.where('category', '==', category),
      sdk.orderBy('createdAt', 'desc'),
    );
    const snapshot = await sdk.getDocs(boardQuery);
    if (!requestIsCurrent(token, category)) return;
    const posts = [];
    snapshot.forEach(item => posts.push({ id: item.id, ...item.data() }));
    renderBoard(posts, category);
  } catch (error) {
    console.error('게시판 로드 실패:', error);
    if (requestIsCurrent(token, category)) {
      document.getElementById('boardList').innerHTML =
        '<p class="board-status board-status-error">게시판 연결에 실패했습니다. 잠시 후 다시 시도해주세요.</p>';
    }
  }
}

function renderBoard(posts, category) {
  const isSuggest = category === 'board-suggest';
  let html = `<div class="board-toolbar"><button class="write-btn" type="button" data-board-action="write" data-category="${escHtml(category)}">✏ ${isSuggest ? '건의하기' : '글 작성'}</button></div>`;
  if (!posts.length) {
    html += `<div class="empty-board">${isSuggest ? '아직 건의 글이 없어요. 자유롭게 남겨주세요!' : '아직 작성된 글이 없어요. 첫 번째 공략을 작성해보세요!'}</div>`;
  } else {
    posts.forEach(post => {
      const date = post.createdAt?.toDate?.()?.toLocaleDateString('ko-KR') || '';
      const done = post.done === true;
      html += `<button class="post-card${done ? ' done' : ''}" type="button" data-board-action="open" data-post-id="${escHtml(post.id)}">
        <span class="post-card-heading"><span class="post-card-title">${escHtml(post.title)}</span>${isSuggest ? `<span class="${done ? 'badge-done' : 'badge-pending'}">${done ? '✓ 완료' : '대기중'}</span>` : ''}</span>
        <span class="post-card-meta"><span>${escHtml(post.authorName)}${post.isAdmin ? ' <span class="admin-badge">✦ 운영자</span>' : ''}</span><span>${date}</span></span>
      </button>`;
    });
  }
  document.getElementById('boardList').innerHTML = html;
}

export async function loadHomePreview() {
  const container = document.getElementById('homeBoardPreview');
  if (!container) return;
  container.setAttribute('aria-busy', 'true');
  try {
    const { db, sdk } = await ensureFirestore();
    const previewQuery = sdk.query(
      sdk.collection(db, 'posts'),
      sdk.orderBy('createdAt', 'desc'),
      sdk.limit(3),
    );
    const snapshot = await sdk.getDocs(previewQuery);
    const posts = [];
    snapshot.forEach(item => posts.push({ id: item.id, ...item.data() }));
    if (!posts.length) {
      container.innerHTML = '<p class="dashboard-empty">아직 등록된 글이 없습니다. 게시판에서 첫 번째 글을 작성해 주세요.</p>';
      return;
    }
    container.innerHTML = posts.map(post => {
      const date = post.createdAt?.toDate?.()?.toLocaleDateString('ko-KR') || '날짜 없음';
      const category = GUIDES[post.category] ? post.category : 'board-suggest';
      const categoryTitle = GUIDES[post.category]?.title || '게시판';
      return `<button class="latest-post-item" type="button" data-page="${escHtml(category)}">
        <span class="latest-post-category">${escHtml(categoryTitle)}</span>
        <span class="latest-post-copy"><strong>${escHtml(post.title || '제목 없음')}</strong><small>${escHtml(date)}</small></span>
        <span class="latest-post-arrow" aria-hidden="true">→</span>
      </button>`;
    }).join('');
  } catch (error) {
    console.error('최신 글 미리보기 로드 실패:', error);
    container.innerHTML = '<p class="dashboard-empty dashboard-empty-error">최신 글을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.</p>';
  } finally {
    container.setAttribute('aria-busy', 'false');
  }
}

async function getPost(postId) {
  const { db, sdk } = await ensureFirestore();
  const snapshot = await sdk.getDoc(sdk.doc(db, 'posts', postId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function openPost(postId) {
  const trigger = document.activeElement;
  const post = await getPost(postId);
  if (!post) return showToast('글을 찾을 수 없어요.');
  const canEdit = isAdmin || (currentUser && currentUser.email === post.authorEmail);
  const date = post.createdAt?.toDate?.()?.toLocaleDateString('ko-KR') || '';
  document.getElementById('postModalTitle').textContent = post.title;
  document.getElementById('postModalMeta').innerHTML = `${escHtml(post.authorName)}${post.isAdmin ? ' <span class="admin-badge">✦ 운영자</span>' : ''} · ${date}`;
  document.getElementById('postModalBody').innerHTML = post.body;
  const buttons = [];
  if (post.category === 'board-suggest' && isAdmin) {
    buttons.push(`<button class="admin-done-btn${post.done ? ' undo' : ''}" type="button" data-board-action="toggle-done" data-post-id="${escHtml(post.id)}" data-done="${String(!post.done)}">${post.done ? '↩ 완료 취소' : '✓ 완료 표시'}</button>`);
  }
  if (canEdit) {
    buttons.push(`<button class="post-action-btn" type="button" data-board-action="edit" data-post-id="${escHtml(post.id)}">수정</button>`);
    buttons.push(`<button class="post-action-btn danger" type="button" data-board-action="delete" data-post-id="${escHtml(post.id)}">삭제</button>`);
  } else if (!post.authorEmail) {
    buttons.push(`<button class="post-action-btn" type="button" data-board-action="edit-confirm" data-post-id="${escHtml(post.id)}">수정</button>`);
    buttons.push(`<button class="post-action-btn danger" type="button" data-board-action="delete-confirm" data-post-id="${escHtml(post.id)}">삭제</button>`);
  }
  document.getElementById('postModalActions').innerHTML = buttons.join('');
  openAccessibleModal('postModal', trigger);
}

async function initializeEditor(body = '') {
  const submitButton = document.querySelector('#writeModal .btn-submit');
  submitButton.disabled = true;
  try {
    const Quill = await ensureQuill();
    if (!quill) {
      quill = new Quill('#quillEditor', {
        theme: 'snow',
        placeholder: '공략 내용을 입력하세요...',
        modules: { toolbar: [[{ header: [2, 3, false] }], ['bold', 'italic', 'underline'], [{ color: [] }], [{ list: 'ordered' }, { list: 'bullet' }], ['blockquote'], ['link'], ['clean']] },
      });
      quill.root.setAttribute('aria-labelledby', 'writeBodyLabel');
    }
    quill.root.innerHTML = body;
    quill.enable(true);
  } catch (error) {
    console.error('Quill 로드 실패:', error);
    showToast('편집기를 불러오지 못했습니다. 다시 열어주세요.');
  } finally {
    submitButton.disabled = !quill;
  }
}

async function openWriteModal(category) {
  document.getElementById('writeModalTitle').textContent = '글 작성';
  document.getElementById('writePostId').value = '';
  document.getElementById('writeCategory').value = category;
  document.getElementById('writeNickname').value = currentUser?.displayName || '';
  document.getElementById('writePassword').value = '';
  document.getElementById('writeTitleInput').value = '';
  document.getElementById('writePwRow').style.display = currentUser ? 'none' : '';
  document.getElementById('writeNicknameRow').style.display = currentUser ? 'none' : '';
  openAccessibleModal('writeModal');
  await initializeEditor('');
}

async function openEditModal(postId) {
  const returnTrigger = getModalTrigger('postModal') || document.activeElement;
  const post = await getPost(postId);
  if (!post) return;
  document.getElementById('writeModalTitle').textContent = '글 수정';
  document.getElementById('writePostId').value = postId;
  document.getElementById('writeCategory').value = post.category;
  document.getElementById('writeNickname').value = post.authorName;
  document.getElementById('writePassword').value = '';
  document.getElementById('writeTitleInput').value = post.title;
  document.getElementById('writePwRow').style.display = (!currentUser || (!isAdmin && currentUser.email !== post.authorEmail)) ? '' : 'none';
  document.getElementById('writeNicknameRow').style.display = 'none';
  closeAccessibleModal('postModal', false);
  openAccessibleModal('writeModal', returnTrigger);
  await initializeEditor(post.body || '');
}

async function submitPost() {
  const { db, sdk } = await ensureFirestore();
  const postId = document.getElementById('writePostId').value;
  const category = document.getElementById('writeCategory').value;
  const title = document.getElementById('writeTitleInput').value.trim();
  const body = quill?.root.innerHTML.trim() || '';
  const nickname = currentUser ? (currentUser.displayName || currentUser.email) : document.getElementById('writeNickname').value.trim();
  const password = document.getElementById('writePassword').value;
  if (!title) return showToast('제목을 입력해주세요.');
  if (!body) return showToast('내용을 입력해주세요.');
  if (!currentUser && !nickname) return showToast('닉네임을 입력해주세요.');
  if (!currentUser && !password) return showToast('비밀번호를 입력해주세요.');

  const data = { category, title, body, authorName: nickname, authorEmail: currentUser?.email || null, isAdmin, updatedAt: sdk.serverTimestamp() };
  if (postId) {
    const postRef = sdk.doc(db, 'posts', postId);
    const snapshot = await sdk.getDoc(postRef);
    if (!currentUser || (!isAdmin && currentUser.email !== snapshot.data()?.authorEmail)) {
      if (snapshot.data()?.passwordHash !== await hashPw(password)) return showToast('비밀번호가 틀렸어요.');
    }
    await sdk.updateDoc(postRef, data);
    showToast('수정 완료!');
  } else {
    if (!currentUser) data.passwordHash = await hashPw(password);
    data.createdAt = sdk.serverTimestamp();
    await sdk.addDoc(sdk.collection(db, 'posts'), data);
    showToast('게시 완료!');
  }
  closeAccessibleModal('writeModal');
  loadBoard(category);
}

async function toggleDone(postId, done) {
  const { db, sdk } = await ensureFirestore();
  await sdk.updateDoc(sdk.doc(db, 'posts', postId), { done });
  showToast(done ? '✓ 완료 표시했어요!' : '완료 취소했어요.');
  closeAccessibleModal('postModal');
  if (currentCategory) loadBoard(currentCategory);
}

async function deletePost(postId, requireConfirmation = true) {
  if (requireConfirmation && !confirm('정말 삭제할까요?')) return;
  const { db, sdk } = await ensureFirestore();
  await sdk.deleteDoc(sdk.doc(db, 'posts', postId));
  showToast('삭제 완료');
  closeAccessibleModal('postModal');
  if (currentCategory) loadBoard(currentCategory);
}

async function confirmAnonymous(postId, action) {
  const password = prompt('비밀번호를 입력하세요:');
  if (!password) return;
  const post = await getPost(postId);
  if (!post || post.passwordHash !== await hashPw(password)) return showToast('비밀번호가 틀렸어요.');
  if (action === 'delete') return deletePost(postId, false);
  return openEditModal(postId);
}

async function uploadImage() {
  const input = document.getElementById('imageUpload');
  const files = input.files;
  if (!files.length) return showToast('파일을 선택해주세요.');
  let uploaded = 0;
  try {
    const { storage, sdk } = await ensureStorage();
    showToast(`업로드 중... (0/${files.length})`);
    for (const file of files) {
      try {
        const storageRef = sdk.ref(storage, `guide-images/${Date.now()}_${file.name}`);
        await sdk.uploadBytes(storageRef, file);
        const url = await sdk.getDownloadURL(storageRef);
        const range = quill?.getSelection(true);
        const index = range ? range.index : quill?.getLength();
        if (quill && Number.isInteger(index)) {
          quill.insertEmbed(index, 'image', url);
          quill.setSelection(index + 1);
        }
        uploaded += 1;
        showToast(`업로드 중... (${uploaded}/${files.length})`);
      } catch (error) {
        console.error('이미지 업로드 실패:', error);
        showToast(`업로드 실패: ${file.name}`);
      }
    }
  } catch (error) {
    console.error('Storage 로드 실패:', error);
    showToast('스토리지 연결 오류');
  }
  input.value = '';
  if (uploaded) showToast(`✅ ${uploaded}장 삽입 완료!`);
}

function runAction(action, target) {
  const postId = target.dataset.postId;
  if (action === 'write') return openWriteModal(target.dataset.category);
  if (action === 'open') return openPost(postId);
  if (action === 'edit') return openEditModal(postId);
  if (action === 'delete') return deletePost(postId);
  if (action === 'edit-confirm') return confirmAnonymous(postId, 'edit');
  if (action === 'delete-confirm') return confirmAnonymous(postId, 'delete');
  if (action === 'toggle-done') return toggleDone(postId, target.dataset.done === 'true');
}

export function bindBoardEvents() {
  if (eventsBound) return;
  eventsBound = true;
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-board-action]');
    if (!target) return;
    const action = target.dataset.boardAction;
    if (action === 'close-post') return closeAccessibleModal('postModal');
    if (action === 'close-write') return closeAccessibleModal('writeModal');
    if (action === 'submit') return submitPost();
    if (action === 'upload') return uploadImage();
    runAction(action, target);
  });
}
