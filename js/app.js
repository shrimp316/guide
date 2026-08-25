const SEARCH_ITEMS = [
  { name:'신 이전', desc:'신 이전 구간 가이드', type:'가이드', page:'guide-pre-god' },
  { name:'신1 ~ 신4', desc:'신1부터 신4까지 구간 가이드', type:'가이드', page:'guide-god1-4' },
  { name:'신4 ~ 신7', desc:'신4부터 신7까지 구간 가이드', type:'가이드', page:'guide-god4-7' },
  { name:'신7 ~ 신11', desc:'신7부터 신11까지 구간 가이드', type:'가이드', page:'guide-god7-11' },
  { name:'신11 ~ 신15', desc:'신11부터 신15까지 구간 가이드', type:'가이드', page:'guide-god11-15' },
  { name:'초월신1 ~ 4', desc:'초월신1부터 4까지 구간 가이드', type:'가이드', page:'guide-super1-4' },
  { name:'초월신4 이후', desc:'초월신4 이후 운영 가이드', type:'가이드', page:'guide-super4' },
  { name:'다이브', desc:'다이브 공략', type:'공략', page:'guide-dive' },
  { name:'신수 공략', desc:'신수 운영 공략집', type:'공략', page:'guide-beast-guide' },
  { name:'차원탐사 공략', desc:'차원탐사 운영 공략집', type:'공략', page:'guide-dimension-guide' },
  { name:'차원열차 공략', desc:'차원열차 운영 공략집', type:'공략', page:'guide-dimension-train' },
  { name:'수치 정보', desc:'게임 수치 정보', type:'정보', page:'guide-amounts' },
  { name:'득도·승천 계산기', desc:'득도 및 승천 소모량 계산', type:'계산기', page:'calc-ascension' },
  { name:'제련 계산기', desc:'재화별 제련 비용 계산', type:'계산기', page:'calc-forge' },
  { name:'신수 계산기', desc:'신수 각성 및 폭주 비용 계산', type:'계산기', page:'calc-beast-cal' },
  { name:'차원탐사 기댓값', desc:'차원탐사 기댓값 계산', type:'계산기', page:'calc-dimension-ev' },
  { name:'진리의 길', desc:'진리 최적 경로 찾기', type:'도구', page:'tool-path' },
  { name:'진리의 나무', desc:'세팅 프리셋 및 누적 효과', type:'도구', page:'tool-tree' },
  { name:'건의게시판', desc:'기능 건의 및 공략 요청', type:'커뮤니티', page:'board-suggest' },
];

const IFRAME_PAGES = {
  'calc-ascension': { src:'calc/ascension.html', title:'득도·승천 계산기' },
  'calc-forge': { src:'calc/forge.html', title:'제련 계산기' },
  'calc-beast-cal': { src:'calc/beast-cal/beast-cal.html', title:'신수 계산기' },
  'calc-dimension-ev': { src:'calc/dimension-ev.html', title:'차원탐사 기댓값' },
  'tool-path': { src:'tool/path.html', title:'진리의 길' },
  'tool-tree': { src:'tool/tree/tree.html', title:'진리의 나무' },
};

export const GUIDES = {
  'guide-pre-god': { title:'신 이전', desc:'신 이전 구간 공략 게시판' },
  'guide-god1-4': { title:'신1 ~ 신4', desc:'신1~신4 구간 공략 게시판' },
  'guide-god4-7': { title:'신4 ~ 신7', desc:'신4~신7 구간 공략 게시판' },
  'guide-god7-11': { title:'신7 ~ 신11', desc:'신7~신11 구간 공략 게시판' },
  'guide-god11-15': { title:'신11 ~ 신15', desc:'신11~신15 구간 공략 게시판' },
  'guide-super1-4': { title:'초월신1 ~ 4', desc:'초월신1~4 구간 공략 게시판' },
  'guide-super4': { title:'초월신4 이후', desc:'초월신4 이후 운영 게시판' },
  'guide-dive': { title:'다이브', desc:'다이브 공략 게시판' },
  'guide-beast-guide': { title:'신수 공략', desc:'신수 공략 게시판' },
  'guide-dimension-guide': { title:'차원탐사 공략', desc:'차원탐사 공략 게시판' },
  'guide-dimension-train': { title:'차원열차 공략', desc:'차원열차 공략 게시판' },
  'guide-amounts': { title:'수치 정보', desc:'수치 정보 게시판' },
  'board-suggest': { title:'건의게시판', desc:'게시판 추가 건의, 공략 요청 등 자유롭게 남겨주세요.' },
};

let currentPage = 'home';
let boardModulePromise;
let toastTimer;
const modalTriggers = new Map();
let activeModalId = null;

function getBoardModule() {
  if (!boardModulePromise) {
    boardModulePromise = import('./board.js').catch(error => {
      boardModulePromise = undefined;
      throw error;
    });
  }
  return boardModulePromise;
}

export function escHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function isPageActive(page) {
  return currentPage === page;
}

export function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

export function getModalTrigger(id) {
  return modalTriggers.get(id) || null;
}

export function openAccessibleModal(id, trigger = document.activeElement) {
  if (activeModalId && activeModalId !== id) closeAccessibleModal(activeModalId, false);
  const overlay = document.getElementById(id);
  if (!overlay) return;
  if (trigger instanceof HTMLElement) modalTriggers.set(id, trigger);
  overlay.setAttribute('aria-hidden', 'false');
  overlay.classList.add('show');
  activeModalId = id;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => overlay.querySelector('.modal')?.focus());
}

export function closeAccessibleModal(id, restoreFocus = true) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
  if (activeModalId === id) activeModalId = null;
  document.body.style.overflow = '';
  const trigger = modalTriggers.get(id);
  if (restoreFocus && trigger?.isConnected) trigger.focus();
  modalTriggers.delete(id);
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
  document.getElementById('menuBtn').setAttribute('aria-expanded', 'false');
}

function navigate(page) {
  closeSidebar();
  history.pushState({ page }, '', page === 'home' ? location.pathname : `${location.pathname}#${page}`);
  showPage(page);
}

function showPage(page) {
  currentPage = page;
  document.querySelectorAll('.view,.view-iframe').forEach(view => view.classList.remove('active'));
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    const active = item.dataset.page === page;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  document.getElementById('mobileTitle').textContent = navItem ? navItem.textContent.trim() : '벽돌주식회사';

  if (page === 'home') {
    document.getElementById('view-home').classList.add('active');
    scheduleHomeBoardPreview();
  } else if (IFRAME_PAGES[page]) {
    const info = IFRAME_PAGES[page];
    document.getElementById('iframeTitle').textContent = info.title;
    const iframe = document.getElementById('contentIframe');
    if (!iframe.src.includes(info.src)) iframe.src = info.src;
    document.getElementById('view-iframe').classList.add('active');
  } else if (GUIDES[page]) {
    document.getElementById('view-guide').classList.add('active');
    window.scrollTo(0, 0);
    getBoardModule()
      .then(board => board.loadBoard(page))
      .catch(error => {
        console.error('게시판 모듈 로드 실패:', error);
        if (isPageActive(page)) document.getElementById('boardList').innerHTML = '<p class="board-status board-status-error">게시판 연결에 실패했습니다.</p>';
      });
  }
}

function normalizeSearch(value) {
  return value.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
}

function renderSearchResults(query) {
  const section = document.getElementById('searchResults');
  const list = document.getElementById('searchResultList');
  const count = document.getElementById('searchResultCount');
  const input = document.getElementById('searchInput');
  const keyword = normalizeSearch(query.trim());
  section.hidden = !keyword;
  input.setAttribute('aria-expanded', String(Boolean(keyword)));
  if (!keyword) {
    list.replaceChildren();
    count.textContent = '';
    return;
  }

  const matches = SEARCH_ITEMS.filter(item => normalizeSearch(`${item.name} ${item.desc} ${item.type}`).includes(keyword));
  count.textContent = `${matches.length}개`;
  if (!matches.length) {
    list.innerHTML = '<p class="dashboard-empty">일치하는 가이드나 도구가 없습니다. 다른 검색어를 입력해 주세요.</p>';
    return;
  }
  list.innerHTML = matches.map(item => `<button class="search-result" type="button" data-page="${escHtml(item.page)}">
    <span class="search-result-type">${escHtml(item.type)}</span>
    <span><strong>${escHtml(item.name)}</strong><small>${escHtml(item.desc)}</small></span>
    <span aria-hidden="true">→</span>
  </button>`).join('');
}

let homePreviewStarted = false;
let homePreviewObserver;
let homePreviewFallbackScheduled = false;

function startHomeBoardPreview() {
  if (homePreviewStarted || !isPageActive('home')) return;
  homePreviewStarted = true;
  getBoardModule()
    .then(board => board.loadHomePreview())
    .catch(error => {
      console.error('홈 최신 글 미리보기 로드 실패:', error);
      const preview = document.getElementById('homeBoardPreview');
      preview.setAttribute('aria-busy', 'false');
      preview.innerHTML = '<p class="dashboard-empty dashboard-empty-error">최신 글을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.</p>';
    });
}

function scheduleHomeBoardPreview() {
  if (homePreviewStarted || homePreviewObserver || homePreviewFallbackScheduled) return;
  const preview = document.getElementById('homeBoardPreview');
  if ('IntersectionObserver' in window) {
    homePreviewObserver = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      homePreviewObserver.disconnect();
      homePreviewObserver = undefined;
      startHomeBoardPreview();
    }, { rootMargin: '160px' });
    homePreviewObserver.observe(preview);
    return;
  }
  homePreviewFallbackScheduled = true;
  const load = () => {
    homePreviewFallbackScheduled = false;
    startHomeBoardPreview();
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(load, { timeout: 1500 });
  else setTimeout(load, 0);
}

function openExternalBrowser() {
  const url = location.href;
  if (/android/i.test(navigator.userAgent)) {
    location.href = `intent://${url.replace(/https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end`;
  } else {
    navigator.clipboard?.writeText(url)
      .then(() => showToast('주소가 복사됐어요! Safari에서 붙여넣기 해주세요.'))
      .catch(() => showToast(`주소창에서 직접 열어주세요: ${url}`));
  }
}

function bindEvents() {
  document.addEventListener('click', event => {
    const pageTarget = event.target.closest('[data-page]');
    if (pageTarget) return navigate(pageTarget.dataset.page);
    const externalTarget = event.target.closest('[data-external-url]');
    if (externalTarget) return window.open(externalTarget.dataset.externalUrl, '_blank');
    const modalClose = event.target.closest('[data-modal-close]');
    if (modalClose) return closeAccessibleModal(modalClose.dataset.modalClose);
    if (event.target.closest('[data-inapp-close]')) return document.getElementById('inappBanner').classList.remove('show');
    if (event.target.closest('[data-open-external]')) return openExternalBrowser();
  });

  document.getElementById('authBtn').addEventListener('click', () => {
    if (document.getElementById('inappBanner').classList.contains('show')) {
      showToast('카카오톡에서는 로그인이 지원되지 않아요. 외부 브라우저를 이용해주세요.');
      return;
    }
    getBoardModule().then(board => board.handleAuthButton());
  });
  document.getElementById('searchInput').addEventListener('input', event => {
    renderSearchResults(event.target.value);
  });
  document.getElementById('menuBtn').addEventListener('click', () => {
    const open = document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('overlay').classList.toggle('show', open);
    document.getElementById('menuBtn').setAttribute('aria-expanded', String(open));
  });
  document.getElementById('overlay').addEventListener('click', closeSidebar);
  window.addEventListener('popstate', event => showPage(event.state?.page || location.hash.replace('#', '') || 'home'));

  const focusableSelector = ['a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])', 'textarea:not([disabled])', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])'].join(',');
  document.addEventListener('keydown', event => {
    if (!activeModalId) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAccessibleModal(activeModalId);
      return;
    }
    if (event.key !== 'Tab') return;
    const overlay = document.getElementById(activeModalId);
    const focusable = [...overlay.querySelectorAll(focusableSelector)].filter(element => element.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      overlay.querySelector('.modal')?.focus();
      return;
    }
    const [first] = focusable;
    const last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === overlay.querySelector('.modal'))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  ['postModal', 'writeModal'].forEach(id => document.getElementById(id).addEventListener('click', event => {
    if (event.target.id === id) closeAccessibleModal(id);
  }));
}

bindEvents();
const initialPage = location.hash.replace('#', '') || 'home';
history.replaceState({ page: initialPage }, '', location.href);

if (/kakaotalk|line|naver|instagram|facebook|twitter/i.test(navigator.userAgent)) {
  document.getElementById('inappBanner').classList.add('show');
}

async function bootstrap() {
  if (sessionStorage.getItem('brick-guide:auth-redirect-pending') === '1') {
    try {
      const board = await getBoardModule();
      await board.resumeRedirectIfPending();
    } catch (error) {
      console.error('로그인 복귀 처리 실패:', error);
    }
  }
  showPage(initialPage);
}

bootstrap();
