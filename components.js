// ── 공통 네비게이션 데이터 ──
const NAV = [
  {
    type: "item",
    label: "홈",
    icon: "🏠",
    href: "/",
    id: "home"
  },
  { type: "divider" },
  {
    type: "group",
    label: "가이드",
    items: [
      { label: "신 이전",     icon: "📖", href: "guide/pre-god.html",   id: "pre-god" },
      { label: "신1 ~ 신4",   icon: "📖", href: "guide/god1-4.html",    id: "god1-4" },
      { label: "신4 ~ 신7",   icon: "📖", href: "guide/god4-7.html",    id: "god4-7" },
      { label: "신7 ~ 신11",  icon: "📖", href: "guide/god7-11.html",   id: "god7-11" },
      { label: "신11 ~ 신15", icon: "📖", href: "guide/god11-15.html",  id: "god11-15" },
      { label: "초월신1 ~ 4", icon: "📖", href: "guide/super1-4.html",  id: "super1-4" },
      { label: "초월신4 이후",icon: "📖", href: "guide/super4.html",    id: "super4" },
    ]
  },
  { type: "divider" },
  {
    type: "group",
    label: "공략",
    items: [
      { label: "다이브",      icon: "🤿", href: "guide/dive.html",            id: "dive" },
      { label: "신수",        icon: "🐉", href: "guide/beast-guide.html",     id: "beast-guide" },
      { label: "차원탐사",    icon: "🔭", href: "guide/dimension-guide.html", id: "dimension-guide" },
    ]
  },
  { type: "divider" },
  {
    type: "group",
    label: "계산기 / 도구",
    items: [
      { label: "득도·승천 계산기",   icon: "⚡", href: "calc/ascension.html",    id: "ascension" },
      { label: "제련 계산기",        icon: "🔨", href: "calc/forge.html",         id: "forge" },
      { label: "신수 계산기",        icon: "🧮", href: "calc/beast-cal.html",     id: "beast-cal" },
      { label: "차원탐사 기댓값",    icon: "🎲", href: "calc/dimension-ev.html",  id: "dimension-ev" },
      { label: "진리의 길",          icon: "🗺️", href: "tool/path.html",          id: "path" },
      { label: "진리의 나무",        icon: "🌳", href: "tool/tree.html",          id: "tree" },
    ]
  },
  { type: "divider" },
  {
    type: "item",
    label: "공식 홈페이지",
    icon: "🌐",
    href: "https://www.seasoninggames.com/ko/blog",
    external: true,
    id: "official"
  }
];

// ── 현재 페이지 ID 감지 ──
function getCurrentPageId() {
  const path = window.location.pathname;
  const filename = path.split('/').pop().replace('.html', '');
  if (!filename || filename === 'index') return 'home';
  return filename;
}

// ── 루트 경로 계산 (하위 폴더 대응) ──
function getRootPath() {
  const depth = window.location.pathname.split('/').length - 2;
  return depth > 0 ? '../'.repeat(depth) : './';
}

// ── 사이드바 HTML 생성 ──
function buildSidebar() {
  const currentId = getCurrentPageId();
  const root = getRootPath();

  function resolveHref(href) {
    if (!href || href.startsWith('http')) return href;
    return root + href;
  }

  function navItem(item) {
    const isActive = item.id === currentId;
    const isExternal = item.external;
    const href = resolveHref(item.href);
    const extAttr = isExternal ? 'target="_blank" rel="noopener"' : '';
    const extBadge = isExternal ? '<span class="ext">↗</span>' : '';
    return `
      <a href="${href}" class="nav-item${isActive ? ' active' : ''}" ${extAttr}>
        <span class="nav-icon">${item.icon}</span>
        ${item.label}
        ${extBadge}
      </a>`;
  }

  let html = `
    <div class="sidebar-header">
      <div class="site-logo">
        <div class="logo-icon">🧱</div>
        <div>
          <div class="site-name">벽돌주식회사</div>
          <div class="site-sub">통합 정보사이트</div>
        </div>
      </div>
    </div>
    <nav class="nav">`;

  NAV.forEach(section => {
    if (section.type === 'divider') {
      html += '<div class="nav-divider"></div>';
    } else if (section.type === 'item') {
      html += `<div class="nav-group">${navItem(section)}</div>`;
    } else if (section.type === 'group') {
      html += `
        <div class="nav-group">
          <div class="nav-group-label">${section.label}</div>
          ${section.items.map(navItem).join('')}
        </div>`;
    }
  });

  html += '</nav>';
  return html;
}

// ── 공통 CSS ──
const COMMON_CSS = `
  :root {
    --bg: #f5f4f0;
    --surface: #ffffff;
    --surface2: #f0efe9;
    --border: #e2e0d8;
    --border2: #d0cec4;
    --text: #1a1917;
    --text2: #6b6960;
    --text3: #9b998f;
    --teal: #1D9E75;
    --teal-light: #E1F5EE;
    --teal-border: #5DCAA5;
    --amber: #BA7517;
    --amber-light: #FAEEDA;
    --purple: #534AB7;
    --purple-light: #EEEDFE;
    --blue: #185FA5;
    --blue-light: #E6F1FB;
    --sidebar-w: 220px;
    --radius: 10px;
    --radius-sm: 6px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Noto Sans KR', sans-serif; background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.6; }
  a { text-decoration: none; color: inherit; }
  .app { display: flex; min-height: 100vh; }

  .sidebar {
    width: var(--sidebar-w); min-width: var(--sidebar-w);
    background: var(--surface); border-right: 1px solid var(--border);
    display: flex; flex-direction: column;
    position: fixed; top: 0; left: 0; height: 100vh;
    overflow-y: auto; z-index: 100;
    transition: transform 0.25s ease;
  }
  .sidebar-header { padding: 20px 16px 16px; border-bottom: 1px solid var(--border); }
  .site-logo { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  .logo-icon { width: 34px; height: 34px; background: var(--text); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 16px; flex-shrink: 0; }
  .site-name { font-size: 14px; font-weight: 700; color: var(--text); line-height: 1.2; }
  .site-sub { font-size: 11px; color: var(--text3); }
  .nav { padding: 10px 8px; flex: 1; }
  .nav-group { margin-bottom: 4px; }
  .nav-group-label { font-size: 10px; font-weight: 500; color: var(--text3); letter-spacing: 0.06em; padding: 8px 8px 4px; text-transform: uppercase; }
  .nav-item { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: var(--radius-sm); font-size: 13px; color: var(--text2); cursor: pointer; transition: background 0.15s, color 0.15s; }
  .nav-item:hover { background: var(--surface2); color: var(--text); }
  .nav-item.active { background: var(--surface2); color: var(--text); font-weight: 500; }
  .nav-icon { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
  .nav-divider { height: 1px; background: var(--border); margin: 8px 8px; }
  .nav-item .ext { margin-left: auto; font-size: 10px; color: var(--text3); }

  .main { margin-left: var(--sidebar-w); flex: 1; padding: 28px 28px 60px; }

  .mobile-header { display: none; position: fixed; top: 0; left: 0; right: 0; height: 52px; background: var(--surface); border-bottom: 1px solid var(--border); z-index: 200; align-items: center; padding: 0 16px; gap: 12px; }
  .hamburger { background: none; border: none; cursor: pointer; font-size: 20px; color: var(--text); padding: 4px; }
  .mobile-title { font-size: 14px; font-weight: 700; }
  .overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 99; }
  .overlay.show { display: block; }

  @media (max-width: 720px) {
    .sidebar { transform: translateX(-100%); }
    .sidebar.open { transform: translateX(0); box-shadow: 4px 0 24px rgba(0,0,0,0.12); }
    .main { margin-left: 0; padding: 72px 16px 48px; }
    .mobile-header { display: flex; }
  }
`;

// ── 초기화 (자동 실행) ──
(function init() {
  // 폰트 로드
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=DM+Mono:wght@400;500&display=swap';
  document.head.appendChild(link);

  // 공통 CSS 주입
  const style = document.createElement('style');
  style.textContent = COMMON_CSS;
  document.head.appendChild(style);

  // 모바일 헤더 삽입
  const mobileHeader = document.createElement('header');
  mobileHeader.className = 'mobile-header';
  mobileHeader.innerHTML = `
    <button class="hamburger" id="menuBtn">☰</button>
    <span class="mobile-title">벽돌주식회사</span>
  `;
  document.body.prepend(mobileHeader);

  // 오버레이 삽입
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'overlay';
  document.body.appendChild(overlay);

  // 사이드바 삽입
  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  sidebar.id = 'sidebar';
  sidebar.innerHTML = buildSidebar();
  document.body.appendChild(sidebar);

  // 모바일 토글 이벤트
  document.getElementById('menuBtn').addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
  });
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  });
})();
