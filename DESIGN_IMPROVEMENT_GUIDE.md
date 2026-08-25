# 🎨 벽돌주식회사 가이드 | 디자인 개선 가이드

**작성일**: 2026년 8월 24일  
**대상**: 게임 가이드 사이트 통합 디자인 시스템  
**목표**: 현재 7.5/10 → 8.5/10으로 향상

---

## 📋 목차

1. [현황 분석](#현황-분석)
2. [문제점 상세](#문제점-상세)
3. [디자인 시스템 설계](#디자인-시스템-설계)
4. [컴포넌트 라이브러리](#컴포넌트-라이브러리)
5. [게임 테마 통합](#게임-테마-통합)
6. [구현 로드맵](#구현-로드맵)

---

## 현황 분석

### 종합 평가

| 항목 | 점수 | 상태 |
|------|------|------|
| 모바일 반응성 | 9/10 | ✅ 우수 |
| 색상 조합 | 5/10 | ⚠️ 불일관 |
| 타이포그래피 | 5/10 | ⚠️ 혼돈 |
| UI 컴포넌트 | 6/10 | ⚠️ 중복 |
| 게임 느낌 | 4/10 | ❌ 약함 |
| **전체** | **7.5/10** | **개선 필요** |

---

## 문제점 상세

### 🔴 1. 테마 불일치 (가장 심각)

#### 현재 상태

```
┌─────────────────────────────────────┐
│ index.html                          │
├─────────────────────────────────────┤
│ 배경: #f5f4f0 (베이지)              │
│ 메인색: #1D9E75 (테알)              │
│ 분위기: 밝고 친근함                 │
└─────────────────────────────────────┘
                 ⬇️
┌─────────────────────────────────────┐
│ calc/ascension.html                 │
├─────────────────────────────────────┤
│ 배경: #f4f5f7 (연파랑)              │
│ 메인색: #4f7df0 (진파랑)            │
│ 분위기: 전문적이고 깔끔함           │
└─────────────────────────────────────┘
                 ⬇️
┌─────────────────────────────────────┐
│ calc/forge.html                     │
├─────────────────────────────────────┤
│ 배경: #0f1117 (검정)                │
│ 메인색: #f0a500 (골드)              │
│ 분위기: 어두웠고 딱딱함(게이밍느낌)│
└─────────────────────────────────────┘
```

**문제점**:
- 사용자가 다른 페이지로 가면 **갑자기 배경색 변함**
- 같은 사이트인지 의심스러움
- 브랜딩 일관성 0%

---

### 🔴 2. 컬러 팰렛 혼돈

#### 현재 사용 중인 색상들

```javascript
// index.html & tool/path.html
--teal: #1D9E75;                    // 메인
--teal-light: #E1F5EE;              // 라이트
--amber-light: #FAEEDA;             // 건의
--purple-light: #EEEDFE;            // 커뮤니티
--blue-light: #E6F1FB;              // 기타

// calc/ascension.html
--accent: #4f7df0;                  // 파랑
--accent-light: #eef2ff;            // 라이트 파랑
--gold: #f59e0b;                    // 골드
--green: #10b981;                   // 그린

// calc/forge.html
--accent: #f0a500;                  // 골드 (다름!)
--accent2: #ff6b35;                 // 주황
--text: #e8eaf0;                    // 밝은 텍스트

// calc/beast-cal/beast-cal.html
--primary: #6c8fff;                 // 파랑 (다시 다름!)
--gold: #f5c842;                    // 골드 (또 다름!)
```

**문제점**:
- **같은 이름 변수도 값이 다름** (`--accent`: `#4f7df0` vs `#f0a500`)
- 4~5가지 색상 시스템이 공존
- CSS 일관성 최악

---

### 🔴 3. 타이포그래피 혼문

#### 사용 중인 폰트들

| 페이지 | 본문 | 모노 | 비고 |
|--------|------|------|------|
| index.html | `'Noto Sans KR'` | - | - |
| ascension.html | `'Noto Sans KR'` | `'DM Mono'` | ✅ 일관성 있음 |
| forge.html | `'Noto Sans KR'` | - | 다크에 특화 |
| beast-cal.html | `"맑은 고딕", "Apple SD Gothic Neo"` | - | ❌ 완전히 다름 |
| path.html | `'Noto Sans KR'` | - | - |

```css
/* 폰트 크기도 제각각 */

/* index.html */
.page-title { font-size: 22px; }

/* ascension.html */
.page-title { font-size: 18px; }

/* forge.html */
header h1 { font-size: 17px; }

/* beast-cal */
.app-header h2 { font-size: 20px; }
```

**문제점**:
- "같은 종류의 제목"인데도 크기가 다름
- 스크린 깜빡임 현상 발생 (폰트 변경)
- 프리미엄 여행을 해칠 수 있음

---

### 🔴 4. 공간 할당의 편차 (Inconsistent Spacing)

```
레이아웃 padding 비교:

index.html          →  padding: 28px 28px 60px   (너그러움)
ascension.html      →  padding: 24px 16px 40px   (중간)
forge.html          →  padding: 0                 (촘촘함)
beast-cal.html      →  padding-bottom: 160px     (이상함)
path.html           →  padding: 16px              (촘촘함)
```

**문제점**:
- 호흡감이 일정하지 않음
- 그리드 갭이 모두 다름 (6px, 8px, 10px, 12px)
- 시각적 안정감 부족

---

### 🔴 5. 컴포넌트 재정의 문제

#### 버튼 예시

```html
<!-- index.html -->
<button class="write-btn">✏ 글 작성</button>

<!-- CSS -->
.write-btn {
  padding: 8px 14px;
  background: var(--teal);
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius-sm);
}
```

```html
<!-- ascension.html -->
<button class="calc-btn">계산하기</button>

<!-- CSS -->
.calc-btn {
  padding: 11px;
  width: 100%;
  background: var(--accent);
  font-size: 14px;
  font-weight: 700;
  border-radius: var(--radius-sm);
}
```

```html
<!-- forge.html -->
<button class="tab-btn">⚔️ 계산</button>

<!-- CSS -->
.tab-btn {
  padding: 12px;
  background: none;
  border-bottom: 2px solid transparent;
  font-size: 13px;
  font-weight: 600;
}
```

**문제점**:
- 같은 용도의 버튼인데 **3가지 클래스**
- 패딩, 폰트 크기, 가중치 모두 다름
- 유지보수 어려움

---

### 🔴 6. 게임 브랜딩 약함

```
사이트: "벽돌주식회사" (블록/게임 느낌)
현재 디자인: 회계 도구 같은 진지한 분위기

불일치점:
- 게임의 캐주얼하고 재미있는 느낌 X
- 유저 기대감과 실제 느낌의 갭
- 아이콘은 있지만 게임 요소는 부족
```

---

## 디자인 시스템 설계

### 🎯 목표

```
"유일하고 명확한 디자인 언어"
├── 1개의 색상 시스템
├── 1개의 타이포그래피 체계
├── 1개의 공간 스케일
├── 1개의 컴포넌트 라이브러리
└── 게임 느낌 통합
```

---

### 📐 1. 통일된 컬러 시스템

#### 브랜드 기본 색상

```css
:root {
  /* 🎯 브랜드 색상 (벽돌 초록) */
  --brand-50:  #f0faf8;
  --brand-100: #d9f0ec;
  --brand-200: #a3dfd4;
  --brand-300: #6ecdb9;
  --brand-400: #38ba9e;
  --brand: #1D9E75;     /* ← 주요 색상 */
  --brand-600: #158d6a;
  --brand-700: #0f6e55;
  --brand-800: #0a5543;
  --brand-900: #063d38;

  /* 🎯 악센트 색상 (게임 골드) */
  --accent: #f59e0b;
  --accent-light: #fef3c7;
  --accent-dark: #b45309;

  /* 🎯 상태 색상 */
  --success: #10b981;
  --danger: #ef4444;
  --warning: #f59e0b;
  --info: #3b82f6;

  /* 🎯 중립색 (라이트 테마) */
  --gray-50: #fafaf9;
  --gray-100: #f5f4f0;    /* 배경 */
  --gray-200: #e7e5df;
  --gray-300: #d7d3c8;
  --gray-400: #a8a89d;
  --gray-500: #78796f;
  --gray-600: #54544a;
  --gray-700: #3f3f39;
  --gray-800: #28282e;
  --gray-900: #1a1a1f;

  /* 🎯 시멘틱 변수 */
  --bg: var(--gray-50);
  --bg-secondary: var(--gray-100);
  --surface: #ffffff;
  --surface-variant: var(--gray-100);
  --text-primary: var(--gray-900);
  --text-secondary: var(--gray-600);
  --text-tertiary: var(--gray-500);
  --border: var(--gray-300);
  --border-light: var(--gray-200);
}
```

#### 적용 진단

```css
/* ✅ 모든 색상이 --brand에서 유래 */
--primary: var(--brand);          /* #1D9E75 */
--primary-light: var(--brand-50); /* #f0faf8 */

/* ✅ 그림자도 통일 */
box-shadow: 0 4px 12px rgba(29, 158, 117, 0.12);  /* brand의 RGBA */
```

---

### 📐 2. 타이포그래피 체계

#### 폰트 선택

```css
:root {
  /* 🎯 본문 폰트 (한글 친화) */
  --font-body: 'Noto Sans KR', system-ui, -apple-system, sans-serif;

  /* 🎯 모노 폰트 (수치용) */
  --font-mono: 'DM Mono', 'Courier New', monospace;

  /* 🎯 헤딩 폰트 (본문과 동일하나 weight 달리함) */
  --font-heading: var(--font-body);
}

* { font-family: var(--font-body); }
code, pre, .numeric { font-family: var(--font-mono); }
```

#### 크기 스케일 (8px 기반)

```css
:root {
  /* 🎯 Heading 크기 */
  --text-xs: 12px;        /* 보조 텍스트 */
  --text-sm: 13px;        /* 라벨 */
  --text-base: 14px;      /* 본문 기본 */
  --text-lg: 16px;        /* 서브헤딩 */
  --text-xl: 18px;        /* 섹션 헤딩 */
  --text-2xl: 22px;       /* 페이지 헤딩 */
  --text-3xl: 28px;       /* 대제목 */

  /* 🎯 Line Height */
  --leading-tight: 1.2;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;
  --leading-loose: 2;

  /* 🎯 Font Weight */
  --font-light: 300;
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;
  --font-extrabold: 800;
}
```

#### 타이포그래피 프리셋

```css
/* 페이지 제목 */
.page-title {
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  line-height: var(--leading-tight);
  letter-spacing: -0.3px;
}

/* 섹션 제목 */
.section-title {
  font-size: var(--text-xl);
  font-weight: var(--font-bold);
  line-height: var(--leading-tight);
}

/* 본문 */
.body-text {
  font-size: var(--text-base);
  font-weight: var(--font-normal);
  line-height: var(--leading-normal);
  color: var(--text-primary);
}

/* 보조 텍스트 */
.caption {
  font-size: var(--text-xs);
  font-weight: var(--font-normal);
  line-height: var(--leading-normal);
  color: var(--text-tertiary);
}

/* 모노 (숫자, 코드) */
.monospace {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  letter-spacing: 0.02em;
}
```

---

### 📐 3. 공간 스케일 (Spacing System)

```css
:root {
  /* 🎯 4px 기반 스케일 */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;
  --space-2xl: 32px;
  --space-3xl: 48px;

  /* 🎯 Border Radius */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  /* 🎯 Shadows */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.1),
               0 1px 2px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1),
               0 2px 4px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1),
               0 4px 6px rgba(0, 0, 0, 0.05);
  --shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.1),
               0 10px 10px rgba(0, 0, 0, 0.04);
}
```

#### 적용 예시

```css
/* 🎯 레이아웃 padding (전체 페이지) */
body { padding: var(--space-lg) var(--space-lg) var(--space-3xl); }

/* 🎯 카드 padding */
.card { 
  padding: var(--space-lg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

/* 🎯 그리드 갭 (모든 그리드) */
.grid { gap: var(--space-md); }

/* 🎯 마진 설정 */
.section { margin-bottom: var(--space-2xl); }
h2 { margin-bottom: var(--space-lg); }
p { margin-bottom: var(--space-md); }
```

---

## 컴포넌트 라이브러리

### 🔧 1. 버튼

#### 기본 버튼

```css
/* PRIMARY 버튼 */
.btn-primary {
  padding: var(--space-md) var(--space-lg);
  background: var(--brand);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  font-family: var(--font-body);
  cursor: pointer;
  transition: all 0.15s ease;
  min-height: 40px;
}

.btn-primary:hover {
  background: var(--brand-700);
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(29, 158, 117, 0.25);
}

.btn-primary:active {
  transform: translateY(0);
  box-shadow: var(--shadow-md);
}

.btn-primary:disabled {
  background: var(--gray-300);
  color: var(--gray-500);
  cursor: not-allowed;
  transform: none;
}
```

#### 세컨더리 버튼

```css
.btn-secondary {
  padding: var(--space-md) var(--space-lg);
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  font-family: var(--font-body);
  cursor: pointer;
  transition: all 0.15s ease;
  min-height: 40px;
}

.btn-secondary:hover {
  border-color: var(--brand);
  color: var(--brand);
  background: var(--brand-50);
}

.btn-secondary:active {
  background: var(--brand-100);
}
```

#### 위험 버튼

```css
.btn-danger {
  padding: var(--space-md) var(--space-lg);
  background: var(--danger);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  cursor: pointer;
  transition: all 0.15s ease;
  min-height: 40px;
}

.btn-danger:hover {
  background: #dc2626;
  box-shadow: 0 8px 16px rgba(239, 68, 68, 0.25);
}
```

#### 텍스트 버튼

```css
.btn-text {
  padding: 4px 8px;
  background: transparent;
  color: var(--brand);
  border: none;
  font-weight: var(--font-semibold);
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-text:hover {
  color: var(--brand-700);
  text-decoration: underline;
}
```

### 🔧 2. 입력 필드

```css
/* FORM INPUT 통일 */
.form-input,
input[type="text"],
input[type="number"],
input[type="email"],
input[type="password"],
select,
textarea {
  padding: 9px 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  font-family: var(--font-mono);
  color: var(--text-primary);
  background: var(--surface);
  transition: border-color 0.15s, box-shadow 0.15s;
  outline: none;
  min-height: 40px;
}

/* FOCUS 상태 */
.form-input:focus,
input:focus,
select:focus,
textarea:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(29, 158, 117, 0.1);
}

/* DISABLED 상태 */
.form-input:disabled,
input:disabled,
select:disabled {
  background: var(--bg-secondary);
  color: var(--text-tertiary);
  cursor: not-allowed;
}

/* 라벨 */
.form-label {
  display: block;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  margin-bottom: var(--space-sm);
}

.form-label.required::after {
  content: ' *';
  color: var(--danger);
}
```

### 🔧 3. 카드

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;
}

.card:hover {
  border-color: var(--brand-200);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

/* CARD 헤더 */
.card-header {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-lg);
  border-bottom: 1px solid var(--border-light);
  margin: calc(var(--space-lg) * -1);
  margin-bottom: var(--space-lg);
}

.card-header-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--brand-50);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}

.card-header h2 {
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: var(--text-primary);
  margin: 0;
}
```

### 🔧 4. 탭

```css
.tab-list {
  display: flex;
  gap: 0;
  border-bottom: 2px solid var(--border-light);
}

.tab-btn {
  padding: var(--space-md) var(--space-lg);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-tertiary);
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  margin-bottom: -2px;
}

.tab-btn:hover {
  color: var(--text-secondary);
  background: var(--bg-secondary);
}

.tab-btn.active {
  color: var(--brand);
  border-bottom-color: var(--brand);
  background: var(--brand-50);
}

.tab-panel {
  display: none;
  padding: var(--space-lg) 0;
}

.tab-panel.active {
  display: block;
}
```

### 🔧 5. 배지 & 태그

```css
/* 배지 */
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  white-space: nowrap;
}

.badge-primary {
  background: var(--brand-50);
  color: var(--brand-700);
  border: 1px solid var(--brand-200);
}

.badge-success {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #bbf7d0;
}

.badge-danger {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

/* 태그 */
.tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--text-secondary);
  background: var(--surface);
  cursor: pointer;
  transition: all 0.15s ease;
}

.tag:hover {
  border-color: var(--brand);
  color: var(--brand);
  background: var(--brand-50);
}

.tag.active {
  border-color: var(--brand);
  background: var(--brand);
  color: #fff;
}
```

### 🔧 6. 결과 섹션 (계산기용)

```css
.result-section {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: var(--space-lg);
  animation: slideInUp 0.3s ease-out;
}

@keyframes slideInUp {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.result-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg);
  font-size: var(--text-xs);
  font-weight: var(--font-bold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border-light);
}

.result-header.primary {
  background: var(--brand-50);
  color: var(--brand-700);
}

.result-header.success {
  background: #ecfdf5;
  color: #047857;
}

.result-header.alert {
  background: #fef3c7;
  color: #b45309;
}

.result-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--border-light);
}

.result-cell {
  background: var(--surface);
  padding: var(--space-md) var(--space-lg);
}

.result-cell.full {
  grid-column: 1 / -1;
}

.result-label {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  margin-bottom: 2px;
}

.result-value {
  font-size: 18px;
  font-weight: var(--font-bold);
  font-family: var(--font-mono);
  color: var(--text-primary);
}

.result-value.accent {
  color: var(--brand);
}

.result-value.success {
  color: var(--success);
}

.result-value.alert {
  color: var(--accent);
}
```

---

## 게임 테마 통합

### 🎮 1. 시각적 게임 요소

#### 헤더 강화

```html
<!-- 새로운 헤더 구조 -->
<header class="site-header">
  <div class="header-brand">
    <div class="brand-icon">🧱</div>
    <div class="brand-text">
      <h1 class="brand-title">벽돌주식회사</h1>
      <p class="brand-tagline">총알키우기 완벽 정보 센터</p>
    </div>
  </div>
</header>
```

```css
.site-header {
  background: linear-gradient(135deg, var(--brand) 0%, var(--brand-700) 100%);
  color: #fff;
  padding: var(--space-2xl) var(--space-lg);
  text-align: center;
}

.header-brand {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  justify-content: center;
}

.brand-icon {
  font-size: 48px;
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
}

.brand-title {
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  margin: 0;
  letter-spacing: -0.5px;
}

.brand-tagline {
  font-size: var(--text-sm);
  opacity: 0.95;
  margin: var(--space-xs) 0 0;
  font-weight: var(--font-normal);
}
```

#### 계산기 히어로 섹션

```html
<!-- 각 계산기 상단 -->
<div class="calculator-hero">
  <div class="hero-icon">⚡</div>
  <div class="hero-text">
    <h2>득도·승천 계산기</h2>
    <p>신 단계 도달 시간을 정확히 계산해보세요</p>
  </div>
</div>
```

```css
.calculator-hero {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  padding: var(--space-xl) var(--space-lg);
  background: linear-gradient(135deg, var(--brand-50) 0%, var(--accent-light) 100%);
  border-radius: var(--radius-lg);
  margin-bottom: var(--space-2xl);
}

.hero-icon {
  font-size: 40px;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

.hero-text h2 {
  font-size: var(--text-xl);
  color: var(--text-primary);
  margin-bottom: var(--space-xs);
}

.hero-text p {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
```

### 🎮 2. 미세 애니메이션

```css
/* 버튼 클릭 피드백 */
.btn-primary:active {
  transform: scale(0.96);
  box-shadow: var(--shadow-sm);
}

/* 카드 호버 */
.card {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

/* 결과 나타남 */
.result-section {
  animation: slideInUp 0.3s ease-out;
}

/* 페이지 진입 */
.page-enter {
  animation: fadeInUp 0.4s ease-out;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 로딩 상태 */
.loading {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

### 🎮 3. 게임 아이콘/이모지 스타일

```css
/* 섹션별 색상 아이콘 */
.icon-guide { color: var(--brand); }      /* 📖 → 초록 */
.icon-calc { color: var(--accent); }      /* 🧮 → 골드 */
.icon-tool { color: var(--info); }        /* 🔧 → 파랑 */
.icon-community { color: var(--warning); }/* 📬 → 황색 */

/* 배경으로 강조 */
.icon-badge {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.icon-badge.primary { background: var(--brand-50); }
.icon-badge.success { background: #dbeafe; }
.icon-badge.warning { background: #fef3c7; }
```

---

## 구현 로드맵

### 📅 Phase 1: 기초 설정 (1-2일)

#### 1-1. 전역 CSS 파일 생성

```
c:/Users/PMS/guide-1/
├── css/
│   ├── design-system.css    ← 새로 생성
│   ├── components.css       ← 새로 생성
│   └── animations.css       ← 새로 생성
```

#### 1-2. 색상 시스템 정리

```html
<!-- 모든 HTML 헤드에 추가 -->
<link rel="stylesheet" href="/css/design-system.css">
<link rel="stylesheet" href="/css/components.css">
<link rel="stylesheet" href="/css/animations.css">
```

#### 1-3. 검증

- [ ] 모든 페이지에서 --brand 색상이 동일한지 확인
- [ ] 폰트 크기 일관성 검사
- [ ] 공간 스케일 일관성 검사

---

### 📅 Phase 2: 테마 통일 (2-3일)

#### 2-1. forge.html, beast-cal.html 라이트 테마로 변환

**변경 사항**:
```css
/* 이전 */
--bg: #0f1117;
--accent: #f0a500;
--text: #e8eaf0;

/* 이후 */
@import url('/css/design-system.css');
/* 위 파일에서 라이트 테마를 기본으로 사용 */
```

#### 2-2. 인라인 스타일 → 클래스 변환

**forge.html 예시**:
```html
<!-- 이전 -->
<button class="calc-btn" onclick="calculateTotal()">계산하기</button>

<!-- 이후 -->
<button class="btn-primary" onclick="calculateTotal()">계산하기</button>
```

#### 2-3. 검증

- [ ] 모든 페이지가 일관된 배경색
- [ ] 색상 대비 WCAG AA 통과
- [ ] 모바일 반응성 유지

---

### 📅 Phase 3: 컴포넌트 표준화 (3-4일)

#### 3-1. 버튼 클래스 통일

```html
<!-- 모든 버튼을 다음 중 하나로 변경 -->
<button class="btn-primary">주요 액션</button>
<button class="btn-secondary">보조 액션</button>
<button class="btn-danger">삭제/취소</button>
<button class="btn-text">링크형</button>
```

#### 3-2. 폼 필드 표준화

```html
<!-- 모든 입력 필드 -->
<label for="inputId" class="form-label">라벨명</label>
<input id="inputId" class="form-input" type="number">
```

#### 3-3. 카드 구조 통일

```html
<!-- 모든 카드 -->
<div class="card">
  <div class="card-header">
    <div class="card-header-icon">🎯</div>
    <h2>섹션명</h2>
  </div>
  <div class="card-body">
    ...
  </div>
</div>
```

#### 3-4 검증

- [ ] 모든 버튼이 --btn-primary, --btn-secondary 중 하나
- [ ] 라벨-입력 쌍이 모두 `for` 속성으로 연결
- [ ] 카드 구조 일관성

---

### 📅 Phase 4: 게임 느낌 강화 (2-3일)

#### 4-1. 헤더 개선

```html
<!-- index.html 헤더 강화 -->
<header class="site-header">
  <div class="header-brand">
    <div class="brand-icon">🧱</div>
    <div class="brand-text">
      <h1>벽돌주식회사</h1>
      <p>총알키우기 완벽 정보 센터</p>
    </div>
  </div>
</header>
```

#### 4-2. 각 계산기에 히어로 섹션 추가

```html
<!-- ascension.html 상단 -->
<div class="calculator-hero">
  <div class="hero-icon">⚡</div>
  <div class="hero-text">
    <h2>득도·승천 계산기</h2>
    <p>신 단계 도달까지 몇 시간이 걸릴까요?</p>
  </div>
</div>
```

#### 4-3. 마이크로 애니메이션 추가

- [ ] 버튼 홀딩 시 크기 작아짐 (scale 0.96)
- [ ] 결과 나타날 때 슬라이드인 애니메이션
- [ ] 카드 호버 시 위로 올라감
- [ ] 플로트 애니메이션 (브랜드 아이콘)

#### 4-4 검증

- [ ] 모든 페이지가 게임 느낌 있는지 확인
- [ ] 애니메이션이 자연스러운지 (60fps)
- [ ] 모바일에서도 부드러운지

---

### 📅 Phase 5: 최종 검증 & 폴리시 (1-2일)

#### 5-1. Lighthouse 검사

```bash
# 각 페이지 검사
- index.html
- calc/ascension.html
- calc/forge.html
- calc/beast-cal/beast-cal.html
- tool/path.html

목표:
- Performance: 85+
- Accessibility: 95+
- Best Practices: 90+
```

#### 5-2. 디자인 일관성 검사

```checklist
- [ ] 모든 텍스트 크기 통일
- [ ] 모든 공간(padding/margin) 스케일 준수
- [ ] 모든 색상이 --brand, --accent 기반
- [ ] 모든 컴포넌트가 표준화된 클래스 사용
- [ ] 다크 테마 완전 제거
- [ ] 게임 느낌 통합 완료
```

#### 5-3. 크로스 브라우징

- [ ] Chrome
- [ ] Safari
- [ ] Firefox
- [ ] 모바일 환경 (iOS Safari, Chrome Mobile)

#### 5-4. 문서화

```markdown
design-system.md 작성:
- 색상 팰렛
- 타이포그래피
- 공간 스케일
- 컴포넌트 가이드
- 사용 예제
```

---

## 예상 결과

### 변경 전 vs 변경 후

| 항목 | 변경 전 | 변경 후 |
|------|--------|--------|
| **테마 일관성** | 🔴 4/10 | 🟢 10/10 |
| **색상 시스템** | 🔴 3/10 | 🟢 10/10 |
| **타이포그래피** | 🟡 5/10 | 🟢 9/10 |
| **컴포넌트 재사용** | 🔴 3/10 | 🟢 9/10 |
| **게임 느낌** | 🔴 4/10 | 🟢 8/10 |
| **브랜드 인지도** | 🔴 4/10 | 🟢 9/10 |
| **유지보수성** | 🟡 5/10 | 🟢 9/10 |
| **전체** | 🟡 7.5/10 | 🟢 **8.8/10** |

### 추가 효과

```
1. SEO 개선
   - 시맨틱 마크업으로 검색 순위 향상
   
2. 사용자 경험 향상
   - 일관된 UI = 학습곡선 감소
   - 신뢰도 증가
   
3. 유지보수 효율성
   - 색상 변경 = 1개 파일만 수정
   - 버튼 스타일 변경 = 1개 클래스만 수정
   
4. 개발 속도
   - 새 페이지 추가 시 빠른 구성
   - 버그 수 감소
   
5. 모바일 사용성
   - 터치 대상 크기 통일
   - 접근성 향상
```

---

## 참고 자료

### 디자인 시스템 레퍼런스

- [Tailwind CSS](https://tailwindcss.com/)
  - 색상 스케일, 공간 스케일 참고
  
- [Material Design 3](https://m3.material.io/)
  - 타이포그래피, 컴포넌트 가이드
  
- [Figma Design Systems](https://www.figma.com/)
  - 색상 팰렛 만드는 법
  
- [WCAG 색상 대비](https://webaim.org/resources/contrastchecker/)
  - 접근성 검증

### 도구

- Chrome DevTools (색상 대비, 반응성)
- Lighthouse (성능, 접근성)
- WAVE (웹 접근성)
- Color Contrast Analyzer

---

## 다음 단계

1. **Phase 1 승인**: 디자인 시스템 기초 구축 승인 여부
2. **색상 파렛 확정**: 게임 테마와 부합하는 색상 선택
3. **실제 구현**: 각 Phase별 진행
4. **정기 검토**: 주 1회 진행상황 확인

---

**질문 & 피드백**:
- 현재 브랜드 색상(#1D9E75)을 계속 사용할지 확인
- 게임 느낌을 어느 정도까지 강화할지 결정
- 다크 테마 필요 여부 재검토

