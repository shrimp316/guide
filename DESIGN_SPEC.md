# 🎨 벽돌주식회사 가이드 — 상세 디자인 개선 명세 (Implementation Spec)

**작성일**: 2026년 8월 24일
**기반 문서**: [DESIGN_IMPROVEMENT_GUIDE.md](DESIGN_IMPROVEMENT_GUIDE.md)(디자인 방향/컴포넌트 초안), [ACCESSIBILITY_DEEP_AUDIT.md](ACCESSIBILITY_DEEP_AUDIT.md)(파일별 버그·접근성 실측)
**이 문서의 역할**: 가이드 문서의 제안을 그대로 옮기지 않고 (1) 제안된 색상 전부를 WCAG 상대휘도 공식으로 실측 검증해 대비 미달 항목을 수정하고, (2) 8개 파일 각각에 대해 정확히 무엇을 바꿔야 하는지 파일:줄 단위로 명세하고, (3) 리디자인 작업을 접근성 P0~P1 수정과 같은 패스에서 처리하도록 통합했습니다.

---

## 0. 먼저 결정해야 할 것 (가이드 문서 자체가 "질문 & 피드백"으로 남긴 항목)

가이드 문서 맨 끝에 3가지가 미결정으로 남아있습니다. 아래 권장안으로 명세를 작성했지만, 다른 선택을 원하면 해당 섹션만 바뀝니다.

| 질문 | 권장안 | 근거 |
|---|---|---|
| **브랜드 색 `#1D9E75` 계속 사용?** | ✅ 유지 | 기존 정체성 유지. 다만 실측 결과 흰 글씨 버튼 배경으로 쓰면 3.39:1로 AA 미달 — §1에서 역할을 분리해 해결 |
| **다크 테마 필요 여부** | ⚠️ 가이드의 "전면 라이트 통일"에 반대 — **2-테마 체계**(라이트/다크-게이밍) 유지를 권장 | forge.html·beast-cal.html·tree.html은 "제련"/"신수"/"스킬트리"처럼 의도적으로 게이밍 느낌을 낸 도구입니다. 이걸 전부 라이트로 바꾸면 리디자인 범위가 "일관성 확보"에서 "3개 도구 정체성 재설계"로 커지고, 정작 문제였던 "토큰 이름은 같은데 값이 다 다르다"는 그대로 다크 테마 안에서도 재발할 수 있습니다. 대신 **라이트 팔레트 1개 + 다크 팔레트 1개를 동일한 토큰 이름·동일한 컴포넌트 구조**로 정의하고(§1.3), 파일별로 정해진 팔레트 중 하나만 쓰게 강제하는 쪽을 권장합니다. |
| **게임 느낌 강도** | 가이드 Phase 4 그대로 채택(헤더 그라디언트+플로트 애니메이션, 계산기 히어로 섹션) — 단, `prefers-reduced-motion` 대응을 필수 조건으로 추가 | ACCESSIBILITY_DEEP_AUDIT.md에서 이미 무한 애니메이션에 감소-모션 대응이 없다는 지적이 있었음. 새 애니메이션을 추가하면서 같은 결함을 또 만들 이유가 없음 |

**본 명세는 이 3가지 권장안을 전제로 작성되었습니다.** 다크 테마 유지 여부만 바뀌어도 §1.3·§3의 forge/beast-cal/tree 항목이 통째로 달라지니, 확정 전 진행하지 않는 걸 권장합니다.

---

## 1. 확정 디자인 토큰 (가이드 제안값 → 대비 실측 → 최종값)

### 1.1 검증 방법

```python
def luminance(hex_color):
    hex_color = hex_color.lstrip('#')
    r, g, b = (int(hex_color[i:i+2], 16) / 255 for i in (0, 2, 4))
    r, g, b = (c/12.92 if c <= 0.03928 else ((c+0.055)/1.055)**2.4 for c in (r, g, b))
    return 0.2126*r + 0.7152*g + 0.0722*b

def contrast(hex1, hex2):
    l1, l2 = luminance(hex1), luminance(hex2)
    l1, l2 = max(l1, l2), min(l1, l2)
    return (l1 + 0.05) / (l2 + 0.05)
```
기준: 일반 텍스트 4.5:1, 큰 텍스트(≥18.66px 또는 ≥14.66px bold)·비텍스트 UI 요소 3:1.

### 1.2 라이트 팔레트 — 수정 사항

가이드 문서 §"통일된 컬러 시스템"의 값을 그대로 계산한 결과, **10개 조합이 AA 일반 텍스트 기준을 통과하지 못했습니다.** 원인은 하나의 토큰(`--brand`, `--accent` 등)을 "배경 채움"과 "텍스트/아이콘"이라는 서로 다른 역할에 동시에 재사용했기 때문입니다 — 역할별로 분리하면 해결됩니다.

| 역할 | 가이드 제안 | 실측 대비 | 판정 | 최종 처리 |
|---|---|---|---|---|
| 흰 글씨 버튼 배경 (`.btn-primary`) | `--brand` #1D9E75 | 3.39:1 | ❌ FAIL | **`--brand-700` #0f6e55**로 교체 (6.21:1) — `--brand`은 아이콘/그라디언트/hover 배경 틴트 전용으로 격하 |
| 브랜드색 텍스트/링크 (`.btn-text`, `result-value.accent`, `tab-btn.active`) | `--brand` | 3.39:1 (본문 크기) | ❌ FAIL | **`--brand-700`** 사용 (6.21:1) |
| 3차 텍스트 (`--text-tertiary`, 캡션) | `--gray-500` #78796f | 4.41:1 (흰 배경) / 4.01:1 (연베이지 배경) | ❌ FAIL | **`#6b6b61`**로 교체 → 5.38:1 / 4.89:1 |
| 게임 골드 텍스트/아이콘 (`--accent`) | #f59e0b | 2.15:1 | ❌❌ FAIL(큰 텍스트도 미달) | 텍스트/아이콘 역할은 **`--accent-dark`** #b45309 사용(5.02:1). `#f59e0b`는 배지 배경·장식용 채움에만 사용 |
| 활성 탭 텍스트 (`.tab-btn.active`) | `--brand` on `--brand-50` | 3.18:1 | ❌ FAIL | `--brand-700` (5.84:1, brand-50 배경 기준) |
| 성공 결과값 (`result-value.success`) | `--success` #10b981 | 2.54:1 | ❌❌ FAIL | **`#047857`**로 교체 (5.48:1) |
| 위험/필수 표시 (`--danger`, `.form-label.required::after`) | #ef4444 | 3.76:1 | ❌ FAIL | **`#b91c1c`**로 교체 (6.47:1) |
| 정보 텍스트 (`--info`) | #3b82f6 | 3.68:1 | ❌ FAIL | **`#1d4ed8`**로 교체 (6.70:1) |
| 입력창 테두리(기능적, 상태 구분용) | `--border-light` #e7e5df | ~1.3:1대 | ❌ FAIL(비텍스트 3:1) | 입력창 전용 **`--border-strong` #8f8a7d** 신설 (3.44:1). 카드 등 순수 장식 테두리는 기존값 유지(장식 요소는 3:1 의무 아님) |
| 포커스 링 | (가이드에 명시 안 됨) | — | — | **`--brand-700`**(6.21:1, 비텍스트 3:1 기준도 충족)을 `:focus-visible` outline 색상으로 표준화 |

`--gray-600`(텍스트 보조, 7.65:1), `--gray-900`(본문, 17.33:1), `--accent-dark on --accent-light`(4.51:1), 배지 3종(5.8~6.8:1)은 가이드 제안값 그대로 통과 — 수정 불필요.

### 1.3 최종 `design-system.css` (라이트 테마 — index.html / path.html / payment.html / dimension-ev.html)

```css
:root {
  /* 브랜드 — 역할 분리 */
  --brand-50:  #f0faf8;
  --brand-100: #d9f0ec;
  --brand-200: #a3dfd4;
  --brand:     #1D9E75;   /* 아이콘·장식·hover 배경 틴트 전용. 텍스트/흰글씨 배경 금지 */
  --brand-700: #0f6e55;   /* 흰 글씨 버튼 배경, 브랜드색 텍스트/링크, 포커스 링 — 이 역할은 항상 이 토큰 */
  --brand-800: #0a5543;

  /* 게임 골드 악센트 — 역할 분리 */
  --accent:      #f59e0b; /* 배지 배경·장식 채움 전용 */
  --accent-light:#fef3c7;
  --accent-dark: #b45309; /* 텍스트/아이콘 역할은 항상 이 토큰 (5.02:1) */

  /* 상태색 — 배경용 vs 텍스트용 분리 */
  --success:      #10b981; /* 배경 채움/아이콘 전용 (큰 요소) */
  --success-text: #047857; /* 텍스트 역할 (5.48:1) */
  --danger:       #ef4444; /* 배경 채움 전용 */
  --danger-text:  #b91c1c; /* 텍스트 역할 (6.47:1) */
  --info:         #3b82f6; /* 배경 채움 전용 */
  --info-text:    #1d4ed8; /* 텍스트 역할 (6.70:1) */

  /* 중립 */
  --gray-50:  #fafaf9;
  --gray-100: #f5f4f0;
  --gray-200: #e7e5df;
  --gray-300: #d7d3c8;
  --gray-400: #a8a89d;
  --gray-600: #54544a;
  --gray-900: #1a1a1f;

  /* 시맨틱 */
  --bg: var(--gray-50);
  --bg-secondary: var(--gray-100);
  --surface: #ffffff;
  --text-primary: var(--gray-900);
  --text-secondary: var(--gray-600);
  --text-tertiary: #6b6b61;      /* gray-500 대체 (5.38:1) */
  --border: var(--gray-300);      /* 장식용, 3:1 의무 없음 */
  --border-strong: #8f8a7d;       /* 입력창 등 기능적 테두리 (3.44:1) */
  --focus-ring: var(--brand-700); /* :focus-visible outline (6.21:1) */

  /* 타이포/스페이싱/라운딩/섀도 — 가이드 원안 그대로 채택 (문제 없음) */
  --font-body: 'Noto Sans KR', system-ui, -apple-system, sans-serif;
  --font-mono: 'DM Mono', 'Courier New', monospace;
  --text-xs:12px; --text-sm:13px; --text-base:14px; --text-lg:16px; --text-xl:18px; --text-2xl:22px; --text-3xl:28px;
  --leading-tight:1.2; --leading-normal:1.5; --leading-relaxed:1.75;
  --font-normal:400; --font-medium:500; --font-semibold:600; --font-bold:700;
  --space-xs:4px; --space-sm:8px; --space-md:12px; --space-lg:16px; --space-xl:24px; --space-2xl:32px; --space-3xl:48px;
  --radius-sm:6px; --radius-md:8px; --radius-lg:12px; --radius-full:9999px;
  --shadow-sm: 0 1px 3px rgba(0,0,0,.1), 0 1px 2px rgba(0,0,0,.06);
  --shadow-md: 0 4px 6px rgba(0,0,0,.1), 0 2px 4px rgba(0,0,0,.06);
}

/* 접근성 — 모든 페이지 공통, 컴포넌트마다 개별 지정하지 않음 */
*:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
}
```

### 1.4 다크(게이밍) 테마 — forge.html / beast-cal.html / tree.html

같은 토큰 이름, 다크용 값으로 재정의. (요청 시 3개 파일의 기존 배경/텍스트 실측 대비도 별도로 계산해 드립니다 — 이 문서에는 라이트 쪽만 우선 확정했습니다.)

```css
:root[data-theme="dark-gaming"] {
  --bg: #0f1117;
  --bg-secondary: #161925;
  --surface: #1a1d29;
  --text-primary: #e8eaf0;
  --text-secondary: #c9cde0;   /* ACCESSIBILITY_REPORT.md 1차 권장값, 재검증 필요 */
  --text-tertiary: #9da3b3;
  --border: #2e3248;
  --border-strong: #454a68;    /* ACCESSIBILITY_AUDIT_calc.md에서 지적된 1.33:1 실패 교체값 */
  /* 브랜드/악센트/상태색은 라이트와 동일한 역할 분리 원칙 적용, 다크 배경 기준으로 재계산 필요 — Phase 2 착수 시 수행 */
}
```
⚠️ 이 블록은 자리표시자입니다. §0에서 다크 테마 유지가 확정되면, forge.html/beast-cal.html/tree.html의 실제 배경 위에서 위 표(1.1의 스크립트)로 각 색상을 다시 계산해 채워야 합니다 — 다른 배경에서 계산된 값을 그대로 가져오면 안 됩니다(design-implementation 스킬 규칙 #1).

---

## 2. 컴포넌트 명세 (디자인 + 접근성 통합)

가이드 문서의 컴포넌트 CSS에 접근성 요구사항을 인라인으로 병합했습니다. **이 프로젝트는 컴포넌트가 파일마다 따로 구현되므로, 아래는 "이렇게 생겨야 한다"가 아니라 "이 마크업 패턴으로 구현해야 한다"는 명세입니다.**

### 2.1 버튼

```html
<!-- 주요 액션: 항상 <button>, div/span onclick 금지 -->
<button class="btn-primary" type="button">계산하기</button>
```
```css
.btn-primary {
  padding: var(--space-md) var(--space-lg);
  background: var(--brand-700);      /* §1.2에서 확정한 값 — --brand 아님 */
  color: #fff;
  border: none; border-radius: var(--radius-md);
  font: var(--font-semibold) var(--text-sm)/1 var(--font-body);
  min-height: 44px;                   /* 가이드 40px → 44px로 상향 (WCAG 2.5.8 권장치, 모바일 주 사용자) */
  cursor: pointer; transition: all .15s ease;
}
.btn-primary:hover { background: var(--brand-800); transform: translateY(-2px); }
.btn-primary:disabled { background: var(--gray-300); color: var(--gray-600); cursor: not-allowed; }
```
`*:focus-visible` 규칙은 §1.3의 전역 규칙이 자동 적용되므로 버튼별로 다시 정의하지 않음.

### 2.2 입력 필드 — 반드시 `<label for>` 동반

```html
<div class="form-group">
  <label for="attempts" class="form-label">투입 횟수</label>
  <input id="attempts" class="form-input" type="number" inputmode="numeric" min="1" required>
</div>
```
```css
.form-input, select, textarea {
  min-height: 44px;
  padding: 9px 12px;
  border: 1px solid var(--border-strong);  /* --border-light 아님 — §1.2 */
  border-radius: var(--radius-md);
  font: var(--text-base) var(--font-mono);
}
.form-input:invalid[required] { border-color: var(--danger-text); }
```
계산 결과가 갱신되는 컨테이너는 항상 다음을 동반:
```html
<div id="result-area" aria-live="polite" aria-atomic="true">...</div>
```
빈 값/음수 입력 시 `NaN`이 아니라 실제 오류 메시지를 같은 `aria-live` 영역에 표시(§4의 파일별 명세 참고).

### 2.3 카드 / 그리드 셀처럼 클릭 가능한 `<div>`

가이드 문서에는 이 패턴이 명시돼 있지 않지만, 8개 파일 전체에서 가장 많이 반복된 결함이므로 명세에 반드시 포함합니다.

```html
<!-- 실제 링크/버튼 기능이면 무조건 진짜 태그 사용 -->
<button class="card" type="button" onclick="navigate('guide-pre-god')">...</button>

<!-- 격자 셀처럼 button으로 감싸기 부적절한 복합 위젯만 예외 -->
<div class="cell" role="button" tabindex="0"
     onclick="onClick(r,c)"
     onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();onClick(r,c);}">
```

### 2.4 탭

```css
.tab-btn { color: var(--text-tertiary); font: var(--font-semibold) var(--text-base); padding: var(--space-md) var(--space-lg); min-height:44px; }
.tab-btn.active { color: var(--brand-700); border-bottom: 2px solid var(--brand-700); background: var(--brand-50); }
```
```html
<div role="tablist" aria-label="계산 종류">
  <button role="tab" id="tab-calc" aria-selected="true" aria-controls="panel-calc" class="tab-btn active">계산</button>
  <button role="tab" id="tab-recipe" aria-selected="false" aria-controls="panel-recipe" class="tab-btn">레시피</button>
</div>
<div role="tabpanel" id="panel-calc" aria-labelledby="tab-calc">...</div>
```
좌우 화살표 키로 탭 전환하는 `keydown` 핸들러 1개를 공통 스크립트로 만들어 forge.html에 적용(§4).

### 2.5 모달

```html
<div class="modal-overlay" id="postModal" role="dialog" aria-modal="true" aria-labelledby="postModalTitle" hidden>
  <div class="modal">
    <h2 id="postModalTitle" class="modal-title">...</h2>
    <button class="modal-close" aria-label="닫기" onclick="closeModal('postModal')">✕</button>
  </div>
</div>
```
```js
function openModal(id, triggerEl) {
  lastTrigger = triggerEl;
  const m = document.getElementById(id);
  m.hidden = false;
  m.querySelector('.modal').focus();
  document.addEventListener('keydown', escHandler);
}
function closeModal(id) {
  document.getElementById(id).hidden = true;
  document.removeEventListener('keydown', escHandler);
  lastTrigger?.focus();
}
function escHandler(e){ if (e.key === 'Escape') closeModal(currentModalId); }
```

### 2.6 배지/태그, 결과 섹션

가이드 원안 그대로 채택 — 단 `.result-value.accent`는 `var(--brand-700)`, `.result-value.success`는 `var(--success-text)`로 색상 참조만 §1.2 최종값으로 교체.

---

## 3. 사이드바/홈 중복 해소 명세 (design-implementation 스킬 규칙 #9, 앞선 대화에서 합의된 방향)

**원칙**: 사이드바 = 카테고리의 유일한 소스. 홈은 카테고리를 다시 나열하지 않고 요약형 진입점 역할만 한다.

### 3.1 현재 구조 (문제)
`index.html:629-660` 사이드바 6개 그룹 = `index.html:693-713`의 `grid-pin/guide/strategy/cal/tool/community` 6개 카드 그리드와 1:1 중복.

### 3.2 새 홈 구조

```
홈 (`#view-home`)
├── [상단] 최근 업데이트 3~4개 (가이드/계산기 어디든, 마지막 수정일 기준 — 데이터 구조에 updatedAt 없으면 이번 작업에서 추가)
├── [중단] 자주 쓰는 도구 바로가기 4개 (계산기 4종 고정 노출 — 사이드바 "계산기/도구" 그룹과 동일 항목이지만 "다시 나열"이 아니라 "빠른 실행"이 목적이므로 카드가 아니라 아이콘+원클릭 버튼형으로 시각적으로 구분)
└── [하단] 건의게시판 최신 글 3개 미리보기 + "더보기" 링크 (게시판 자체는 사이드바 "건의게시판"으로 진입, 홈엔 미리보기만)
```

`grid-guide`(가이드 7개 전체 나열), `grid-strategy`(공략 3개 전체 나열), `grid-tool`(도구 2개 전체 나열)은 **삭제** — 이 목록은 사이드바에만 존재. `grid-pin`(공지 고정 카드)은 "최근 업데이트"로 대체.

### 3.3 구현 메모
- `renderCard()`(`index.html:895`)는 카드 렌더 함수 자체는 재사용 가능 — 호출하는 데이터셋만 축소
- 이 변경은 §4의 index.html 항목과 같은 패스에서 처리 (헤딩 구조 추가, div→button 전환과 마크업이 겹침)

---

## 4. 파일별 실행 명세

각 항목은 "무엇을 바꾸는가" + "같은 파일을 여는 김에 함께 처리할 접근성 수정"(ACCESSIBILITY_DEEP_AUDIT.md 인용)을 묶었습니다.

### 4.1 index.html
| 작업 | 상세 |
|---|---|
| CSS 토큰 교체 | `:root`(407행대)를 §1.3 `design-system.css`로 전면 교체. 기존 `--text3`(2.60~2.86:1) 계열 사용처 8곳을 `--text-tertiary`로 치환 |
| 헤딩 도입 | `site-name`(619), `guide-title`(721), `modal-title`(744), `section-title`(692-712)을 `<h1>/<h2>/<h3>`로 승격 (§2.5 모달 구조와 함께) |
| 클릭 div→button | 사이드바 17개 `.nav-item`(630-663), `renderCard()`(895) 결과물, `.post-card`(144) → §2.3 패턴 적용 |
| 모달 | postModal/writeModal → §2.5 구조로 교체 |
| 폼 라벨 | writeModal 5개 필드(767-789) → `<label for>` 연결 |
| 결과/토스트 라이브 영역 | `#toast`(807) → `role="status" aria-live="polite"` |
| 헤더 강화(선택, Phase 4) | §0 권장에 따라 가이드의 그라디언트 헤더 채택 시 `prefers-reduced-motion` 처리 포함해서 적용 |
| 홈 카드 축소 | §3.2 구조로 `grid-guide/strategy/tool` 제거, 최근 업데이트/바로가기/게시판 미리보기로 교체 |
| CTA 버튼 색상 | `.write-btn`/`.btn-submit` 배경을 `--brand-700`으로 (기존 3.39:1 실패 → 6.21:1) |

### 4.2 calc/ascension.html
| 작업 | 상세 |
|---|---|
| CSS 토큰 교체 | `--accent`(#4f7df0), `--gold`(#f59e0b), `--green`(#10b981) 등 자체 팔레트 → §1.3 공통 토큰 |
| 홈 버튼 복구 | `.home-btn` CSS(51-63)는 있으나 마크업에 없음 — `<a class="home-btn" href="../index.html" aria-label="홈으로">🏠</a>`를 `.topbar`에 추가 |
| 단계 선택 키보드화 | `.stage-chip`(372-373, 474-485) → §2.3 `role="button" tabindex="0"` + keydown |
| NaN 방지 | `calculate()`(554-628) 최상단에 `if (!attempts || attempts<=0 || isNaN(attempts)) { showError(...); return; }` |
| 라벨 연결 | 371,380,388,393,398 `<div class="form-label">` → `<label for>` |
| aria-live | `#result-area`(420) 추가 |
| 결과 색상 교체 | `.result-cell-value.gold`→`--accent-dark`, `.green`→`--success-text` (§1.2) |

### 4.3 calc/dimension-ev.html
| 작업 | 상세 |
|---|---|
| 탐색 요소 신설 | 페이지 전체에 헤딩/홈 링크가 없음 — `<h1>`(가려도 됨) + 홈 링크를 헤더로 추가 |
| `<option>` 값 버그 수정 | `126-127` 알파/베타 둘 다 `value="81"` — 베타의 실제 칸 수로 수정 |
| NaN 방지 | `200`의 `isNaN` 미탐지 가드 보완 |
| 라벨 연결 | `124-125,137-138,141-142` `<label>`에 `for` 추가 |
| aria-live + role=alert | `#result`(148)에 적용, 기존 경고 메시지("⚠️ 올바른 남은 칸 수...") 유지 |
| 차트 대체텍스트 | Chart.js 캔버스 4개(152,156,160,164)에 `aria-label` |

### 4.4 calc/forge.html
| 작업 | 상세 |
|---|---|
| CSS 토큰 교체 | §0 결정에 따라 다크 유지 시 §1.4 팔레트로, 라이트 통일 시 §1.3으로 |
| 홈 버튼 복구 | `.home-btn`(311-326) 마크업 부재 — ascension.html과 동일 처리 |
| 토글 접근성 이름 | 13개 "0 처리" 토글(456-459) → `aria-label="${name} 0으로 처리"` |
| 토글 포커스 | `input[type=checkbox]` 0px 크기 문제(163) → `:focus-visible` 규칙을 `.toggle-slider`에 위임 |
| 탭 구조 | §2.4 `role="tablist"` 패턴 적용 + 화살표 키 핸들러 |
| aria-live | `#resultCard`(371-372) |
| 가격 입력 클램프 | `getPrice()`(478) 음수 방지 `Math.max(0, val)` |

### 4.5 calc/beast-cal/beast-cal.html
| 작업 | 상세 |
|---|---|
| CSS 토큰 교체 | §0 결정에 따름 (forge.html과 동일 처리) |
| 활성 버튼 대비 | `button.active`/`.step-chip[data-state="tar"]`(88-93, 289-294) 흰 글씨-on-primary 3.00:1 → 텍스트 역할 토큰으로 교체 |
| 죽은 CSS 규칙 수정 | 모바일 미디어쿼리 `.step-btn`(477) → 실제 요소명 `.step-chip`으로 이름 정정 |
| select 라벨 | `#effectFilter`(513-515)에 `aria-label` 또는 `<label>` 추가 |
| 포커스 스타일 | 전역 `:focus-visible` 규칙 도입(§1.3/1.4)으로 해결 |
| aria-live | 요약 패널(944-988) 숫자 span 단위로 개별 적용(패널 전체 X — 과다 알림 방지) |

### 4.6 tool/path.html
| 작업 | 상세 |
|---|---|
| CSS 토큰 교체 | §1.3 |
| 그리드 키보드화 | `236-292` 셀을 §2.3 패턴으로 — 방향키 이동 + Enter/Space 액션, 길게-누르기(등급 순환)는 별도 키(Shift+Enter 등) 매핑 |
| 색상 단독 구분 해소 | 등급 2-6을 색상만이 아니라 셀 안에 점수 숫자 텍스트 표기 |
| 등급 순환 버그 수정 | `cycleCellGrade`(219-228) 로직상 "일반(2등급)"에 개별 셀로 도달 불가 — 분기 조건 수정 |
| 모드 버튼 크기 | `.btn`(100-104) 높이 44px로 확대 |
| 라벨 연결 | `112-113` `<label>승천 단계</label>`에 `for` 추가 |
| 그리드 전체폭 사용 | `.grids-wrap`을 480px 이하에서 1열로(현재 2열 그리드가 셀 크기를 절반으로 만듦) |

### 4.7 tool/payment.html
| 작업 | 상세 |
|---|---|
| CSS 토큰 교체 | §1.3, 특히 `#007bff` 계열(3.78~3.98:1 미달) → `--brand-700`/`--info-text` |
| 다운로드 기능 연결 | `downloadFiltered()`(161-176)가 구현돼 있으나 호출되지 않음 — 버튼에 연결하거나 함수 제거 후 🌐 버튼 라벨을 실제 동작("Takeout 열기")에 맞게 정정 |
| 필터 문자열 정정 | 안내 문구 "벽돌주식회사"(60-61) vs 실제 매칭 "벽돌 주식회사"(141, 공백 있음) — 공백 정규화 또는 실제 CSV 대조 후 통일 |
| 파일 입력 라벨 | `#fileInput`(64)에 `<label for>` 추가 |
| aria-live | `#output`(67) |
| 안내문 단계화 | 60-62 문단을 1/2/3 번호 목록으로 분리 |

### 4.8 tool/tree/tree.html
| 작업 | 상세 |
|---|---|
| CSS 토큰 교체 | §0 결정에 따름(다크 유지 시 §1.4), `--text-dim`(#3d6644, 2.64~2.83:1) 계열 전체 교체 |
| 노드 키보드화 | 289개 `.cell`(1042-1067) → §2.3 패턴 + 접근성 이름(위치+효과+상태) `aria-label`, `refresh()`/`onClick`/`onHover`에서 동기화 |
| 포커스 시 정보패널 갱신 | `onHover`(1361)에 `focus` 리스너 추가 (mouseenter 전용 → focus도 동일 동작) |
| 모달 | §2.5 구조 적용 (`1719-1725`) |
| 터치 타겟 확대 | `.cell-inner` 480px 이하 23px → 최소 24px(WCAG 최소), 가능하면 32px+ |
| WASM 외부화 | `1575`의 1.78MB 인라인 base64 → `brotli.wasm` 파일로 분리, Import/Export 실제 사용 시점에 지연 로드 |
| 상태 비색상 구분 | `.cell.activated`(171-199)에 색상 외 배지/체크마크 추가 |

---

## 5. 통합 로드맵 (디자인 Phase × 접근성 P0~P3)

가이드의 Phase 1~5와 감사보고서의 P0~P3를 같은 파일을 여는 시점에 함께 처리하도록 재배열했습니다.

| Phase | 내용 | 포함되는 접근성 항목 |
|---|---|---|
| **0. 확정** | §0의 3가지 결정 확정 (브랜드색/다크테마/게임느낌 강도) | — |
| **1. 토큰 확정 + 즉시 버그** | §1.3(+§1.4 확정 시) css 파일 생성, 8개 파일에 링크. **이 패스에서 P0 버그 동시 처리**: ascension/dimension-ev NaN, dimension-ev `<option>` 복붙버그, ascension/forge 홈버튼 죽음, payment.html 문자열 불일치, path.html 등급순환 버그 | P0 전체 |
| **2. 테마 통일** | forge/beast-cal/tree 팔레트 확정 적용 (§1.4), index/path/payment/dimension-ev는 §1.3 | P2(대비) 전체 |
| **3. 컴포넌트 표준화 + 키보드화** | §2의 버튼/입력/카드/탭/모달 패턴을 8개 파일에 적용 — **div→button 전환을 컴포넌트 교체와 동시에** 수행(마크업을 두 번 건드리지 않도록) | P1(키보드) 전체, 라벨 for 연결 |
| **4. 홈 재구성 + 게임 느낌** | §3 홈 대시보드 구조, 가이드 Phase 4 헤더/히어로/애니메이션(`prefers-reduced-motion` 필수 동반) | — |
| **5. 검증** | Lighthouse + 수동 키보드 트레이스(Tab만으로 전 기능 도달 확인) + 대비 재계산(§1.1 스크립트로 최종 배포 색상 재확인) | 전체 재검증 |

---

## 6. Phase별 완료 기준 (체크리스트)

- [x] **Phase 1**: `grep -rn "tabindex=\|role=\|aria-"` 결과 카운트가 이전보다 증가했는지 파일별로 확인 / P0 버그 5건 재현 불가 확인
- [x] **Phase 2**: §1.1 스크립트로 최종 CSS의 모든 텍스트-배경 조합 재계산 → 전부 4.5:1(본문) / 3:1(큰 텍스트) 이상
- [ ] **Phase 3**: 마우스 없이 Tab+Enter/Space만으로 각 파일의 모든 핵심 기능(계산 실행, 모달 열기/닫기, 탭 전환, 그리드 셀 조작) 도달 가능한지 수동 확인
- [ ] **Phase 4**: 홈 화면에서 사이드바와 동일한 카테고리 목록이 두 번 나열되지 않는지 확인 / 새 애니메이션에 reduced-motion 대응 확인
- [ ] **Phase 5**: Lighthouse Accessibility 95+ (index.html, ascension.html, forge.html, beast-cal.html, path.html 5개 페이지 기준)
