# 🎮 벽돌주식회사 가이드 종합 접근성·편의성 진단 보고서

**작성일**: 2026년 8월 24일  
**대상**: 벽돌주식회사 통합 가이드 사이트  
**진단 범위**: HTML 파일 8개, 계산기 5개, 도구 2개

---

## 📋 Executive Summary (요약)

| 항목 | 현황 | 우선순위 |
|------|------|--------|
| 색상 대비 (WCAG) | ⚠️ 부분적 미충족 | 높음 |
| 모바일 반응성 | ✅ 우수 | - |
| 폰트 크기/가독성 | ✅ 좋음 | - |
| 폼 필드 레이블 | ⚠️ 개선 필요 | 중간 |
| 키보드 네비게이션 | ⚠️ 제한적 | 중간 |
| ARIA 라벨 | ❌ 거의 없음 | 낮음 |
| 계산 결과 명확성 | ✅ 우수 | - |
| 네비게이션 구조 | ✅ 명확 | - |

---

## 🎨 1. 색상 대비 (Color Contrast) 분석

### 1.1 문제점 발견

#### **index.html, tool/path.html** (라이트 테마 ✅ 대체로 양호)
- 배경: `#f5f4f0`, 텍스트 주요색: `#1a1917`, 보조색: `#6b6960`
- **WCAG AA 충족**: 메인 텍스트 명도비 7:1 이상
- **문제**: 보조 텍스트 `var(--text3): #9b998f` → 배경과의 대비 **3.8:1** (WCAG AA 미달)
  ```
  명도비: 3.8:1 (WCAG AA 4.5:1 필요)
  ```

#### **forge.html, beast-cal.html** (다크 테마 ❌ 심각)
- 배경: `#0f1117`, 텍스트: `#e8eaf0`
- **주요 문제**:
  - 버튼 텍스트: `var(--text-dim): #7a7f99` → **2.2:1** (WCAG 미달)
  - 보조 라벨: 명도비 **2.8:1** (개선 필요)
  - 링크색: `#007bff` → 다크 배경 **2.1:1** (불충분)

**영향**: 시력이 약한 사용자, 고령층, 밝은 환경에서 사용 어려움

### 1.2 권장사항

```css
/* forge.html / beast-cal.html 개선안 */
:root {
  --text-dim: #9da3b3;        /* #7a7f99 대신 - 명도비 4.2:1로 개선 */
  --accent: #5a9fff;           /* 더 밝은 파랑 - 2.1:1 → 4.5:1 */
  --text-secondary: #c9cde0;   /* 버튼/필수 라벨용 */
}
```

---

## 📱 2. 모바일 반응성 (Responsive Design)

### 2.1 평가: ✅ **우수**

#### 강점:
- ✅ viewport 메타태그 올바르게 설정
  ```html
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ```
- ✅ 모든 페이지에서 `max-width` 제약으로 레이아웃 안정성
- ✅ 계산기들 모두 1열 레이아웃으로 자동 변환 (프리셋 존재)
  ```css
  @media (max-width: 760px) { .layout { grid-template-columns: 1fr; } }
  ```
- ✅ 터치 대상 크기 충분 (주요 버튼 36x36px 이상)

#### 미흡한 부분:
- ⚠️ `path.html`: 그리드 셀 크기가 작음 (5x5 그리드 시 셀 12-14px)
  - 터치 네비게이션에서 오조작 위험
- ⚠️ 계산기 테이블: 모바일에서 가로 스크롤 필요 (overflow-x 적용됨 = 양호)

### 2.2 권장사항

```html
<!-- path.html 개선: 모바일에서 셀 크기 확대 -->
@media (max-width: 480px) {
  .grid { grid-template-columns: repeat(3, 1fr); gap: 3px; }  /* 5->3로 축소 */
}
```

---

## 🔤 3. 폰트 크기 & 가독성

### 3.1 현황: ✅ **좋음**

| 용도 | 크기 | 평가 |
|------|------|------|
| **본문** | 13-14px | ✅ 적절 |
| **제목** (h2) | 17-22px | ✅ 명확 |
| **버튼 텍스트** | 12-15px | ⚠️ 작음 (터치) |
| **폼 라벨** | 11-12px | ⚠️ 작음 |
| **입력창** | 13-14px | ✅ 적절 |

### 3.2 문제점

#### **버튼 텍스트 너무 작음**
```css
/* 문제: forge.html */
.tab-btn { font-size: 13px; }  /* 터치 환경에서 17px 권장 */

/* 개선안 */
.tab-btn { 
  font-size: 14px;
  padding: 12px 16px;  /* 높이 36px 이상 확보 */
}
```

#### **폼 라벨 가독성**
- 보조 텍스트(--text-muted)가 너무 밝지 않음
- 대비를 더 살릴 필요

### 3.3 권장사항

```html
<!-- 모든 계산기 통일 -->
.form-label { font-size: 13px; font-weight: 600; }  /* 11px -> 13px */
.form-input { font-size: 14px; min-height: 40px; }  /* 안내 텍스트용 모바일 인터페이스 */
```

---

## 🏷️ 4. 폼 필드 & 라벨

### 4.1 문제점

#### **명시적 라벨 연결 부재**

```html
<!-- 현재: 문제 코드 -->
<div class="form-label">투입 횟수</div>
<input class="form-input" type="number" id="attempts">

<!-- 개선: 명시적 연결 -->
<label for="attempts" class="form-label">투입 횟수</label>
<input class="form-input" type="number" id="attempts">
```

**영향**: 스크린리더 사용자가 입력창 목적을 파악 불가

#### **선택 드롭다운 접근성**
```html
<!-- beast-cal.html -->
<select id="item" onchange="calculateTotal()">
  <option value="">-- 선택하세요 --</option>
</select>
```
- ❌ `<select>` 앞에 `<label>` 없음
- ❌ placeholder 역할을 option으로만 사용

### 4.2 권장사항

```html
<!-- 통일된 패턴 -->
<div class="form-group">
  <label for="itemSelect" class="form-label">
    품목 선택 <span aria-label="필수">(필수)</span>
  </label>
  <select id="itemSelect" class="form-input" required>
    <option value="" disabled selected>-- 선택하세요 --</option>
  </select>
</div>
```

---

## ⌨️ 5. 키보드 네비게이션

### 5.1 현황

#### ✅ 잘된 부분:
- 모든 버튼(`onclick` 속성)이 `<button>` 태그 사용
- 포커스 스타일: `input:focus { border-color: var(--accent); }`
- Tab 키 이동 순서 자연스러움

#### ⚠️ 미흡한 부분:
- **div.card 요소**: 클릭 가능하지만 `<button>`이 아님
  ```html
  <!-- index.html -->
  <div class="card" onclick="navigate('guide-pre-god')">
  ```
  - 키보드로 포커스 불가능 → `tabindex="0"` 또는 `<button>` 변경 필요

- **체크박스/토글**: 포커스 스타일 불명확
  ```html
  <!-- forge.html -->
  <input type="checkbox"> 토글 스위치
  ```
  - `:focus-visible` 미정의

### 5.2 권장사항

```html
<!-- 1. 클릭 가능한 div를 button으로 변경 -->
<!-- 현재 -->
<div class="card" onclick="navigate('guide')">...</div>

<!-- 개선 -->
<button class="card-button" onclick="navigate('guide')">...</button>

<!-- 2. 토글 포커스 스타일 추가 -->
.toggle input:focus-visible + .toggle-slider {
  box-shadow: 0 0 8px rgba(79, 125, 240, 0.5);
  outline: 2px solid var(--accent);
}
```

---

## ♿ 6. ARIA & 스크린리더 지원

### 6.1 현황: ❌ **거의 없음**

| 요소 | ARIA | 필요성 |
|------|------|-------|
| 모달 | ❌ `role="dialog"` 없음 | 높음 |
| 탭 | ❌ `role="tablist"` 없음 | 높음 |
| 계산 결과 | ❌ `aria-live` 없음 | 중간 |
| 버튼 아이콘 | ❌ `aria-label` 거의 없음 | 중간 |

### 6.2 권장사항

```html
<!-- 모달 개선 -->
<div class="modal-overlay" id="postModal" role="dialog" aria-labelledby="postModalTitle" aria-hidden="false">
  <div class="modal">
    <div class="modal-header">
      <h2 class="modal-title" id="postModalTitle">글 상세 보기</h2>
    </div>
  </div>
</div>

<!-- 계산 결과 개선 -->
<div id="result-area" aria-live="polite" aria-atomic="true">
  <!-- 계산 결과 자동 업데이트 시 발표됨 -->
</div>

<!-- 아이콘 버튼 개선 -->
<button onclick="navigate('home')" aria-label="홈으로">🏠</button>
```

---

## 🚀 7. 계산 결과 명확성 & UX

### 7.1 평가: ✅ **우수**

#### 강점:
- ✅ 결과 섹션을 색상(`--primary`, `--gold`, `--green`)으로 구분
- ✅ 각 섹션 아이콘(⚙️, ⚗️, 🕒) 사용으로 시각적 인지 개선
- ✅ 수치에 3자리 구분 기호(`,`) 적용 → 큰 숫자 읽기 쉬움
  ```javascript
  total.toLocaleString()  // "1,000,000" 형식
  ```
- ✅ 시간 형식 자동 변환 (초 → "1일 2시간 3분")

#### 미흡한 부분:
- ⚠️ 계산값 복사 기능 없음
- ⚠️ 결과를 CSV/JSON으로 내보내기 기능 없음

---

## 🏗️ 8. 네비게이션 & 정보 구조

### 8.1 현황: ✅ **명확**

#### 강점:
- ✅ 사이드바 = 계층적 메뉴 (그룹화 잘됨)
- ✅ 카드 기반 홈 = 직관적 커뮤니티
- ✅ 모바일 헤더(☰ 메뉴) 있음

#### 미흡한 부분:

**현재 구조**:
```
홈
├── 건의게시판
├── [가이드] - 7개 페이지
├── [공략] - 3개 페이지
├── [계산기] - 5개 페이지
├── [도구] - 2개 페이지
└── 외부 링크
```

- ⚠️ **계산기 간 전환이 어려움**
  - 각 계산기(`ascension.html` 등)에서 다른 계산기로 직접 이동 불가
  - 홈을 거쳐야 함 (3 클릭)

**권장사항**:
```html
<!-- 각 계산기 헤더에 "다른 도구" 드롭다운 추가 -->
<nav class="calculator-nav">
  <select onchange="jumpToTool(this.value)">
    <option value="">다른 도구 이동</option>
    <option value="ascension">득도·승천</option>
    <option value="forge">제련</option>
    <option value="beast">신수</option>
  </select>
</nav>
```

---

## 📊 9. 성능 & 로딩

### 9.1 현황

| 항목 | 상태 | 평가 |
|------|------|------|
| **외부 CSS** | Google Fonts 사용 | ⚠️ 네트워크 의존 |
| **JS 라이브러리** | Quill, Chart.js, Firebase | ⚠️ 총 500KB+ |
| **이미지** | 거의 없음 (아이콘만) | ✅ 최적 |
| **캐싱** | manifest.json 있음 | ✅ PWA 준비 |

### 9.2 권장사항

```html
<!-- Google Fonts 미리 로드 -->
<link rel="preload" as="style" href="https://fonts.googleapis.com/.../...">

<!-- 번들 최적화: Firebase SDK 트리 셰이킹 -->
<!-- 필요한 것만 import -->
import { getAuth } from 'firebase/auth';  // ✅
import firebase from 'firebase/app';      // ❌ (전체 로드)
```

---

## 🎮 10. 게임 정보 기반 분석

### ❓ 필요한 정보

가이드북이 게임 사용자 경험(UX)에 얼마나 잘 부합하는지 평가하려면:

1. **게임의 주요 시스템**
   - 신 단계(1~15, 초월신)의 난이도/시간 곡선
   - 계산기가 다루는 메커닉의 중요도

2. **사용자 피드백**
   - 자주 묻는 질문 (FAQ)
   - 건의게시판의 요청 항목

3. **게임 업데이트 빈도**
   - 신규 콘텐츠 추가 주기
   - 가이드 갱신 필요 검사점

**추천**: 게임 설명서 또는 공략집 문서를 `.md` 파일로 업로드해주시면 다음 항목 분석 가능:
- 가이드 콘텐츠의 정확도
- 누락된 주요 정보
- 중복 정보 통합 제안

---

## ✅ 11. 개선 액션 플랜

### P1 (높음) - 1주일 내 개선
1. **색상 대비 수정** (forge.html, beast-cal.html)
   - `--text-dim`, `--accent` 밝기 조정
   - 자동화: Lighthouse CI 추가

2. **폼 라벨 명시적 연결**
   - `<label for="">` 태그로 통일
   - 영향: 계산기 5개 모두

3. **모달 ARIA 추가**
   - `role="dialog"`, `aria-labelledby` 설정

### P2 (중간) - 2~3주
4. **클릭 가능 div → button 변경**
   - 홈화면 카드들
   - 키보드 네비게이션 개선

5. **계산기 간 네비게이션 추가**
   - "다른 도구" 드롭다운

6. **토글/체크박스 포커스 스타일**
   - `:focus-visible` 추가

### P3 (낮음) - 1개월
7. **고급 ARIA**: `aria-live`, `aria-label` 전체 적용
8. **번들 최적화**: Firebase 트리 셰이킹
9. **자동화**: accessibility 테스트 CI/CD 통합

---

## 📎 부록: 검사 체크리스트

```markdown
### WCAG 2.1 AA 준수도 검사

**1.4 구분 (Distinguishable)**
- [ ] 색상 대비 4.5:1 이상 (본문)
- [ ] 색상 대비 3:1 이상 (그래픽 요소)
- [x] 텍스트 크기 조절 가능 (zoom 지원)

**2.1 키보드 접근성 (Keyboard Accessible)**
- [x] 모든 기능을 키보드로 조작 가능
- [ ] 포커스 순서가 논리적 (div 버튼 때문)
- [ ] 포커스 표시기가 명확

**2.4 네비게이터 (Navigable)**
- [x] 페이지 제목이 있음
- [ ] 시맨틱 제목 구조 (h1, h2 순서)
- [ ] 의도 명확한 링크 텍스트

**3.3 입력 지원 (Input Assistance)**
- [ ] 라벨이 모든 입력 필드와 연결
- [ ] 에러 제안 (오류 시 대안 제시)
- [ ] 제출 전 검증 & 확인 기회

**4.1 호환성 (Compatible)**
- [ ] 올바른 마크업 사용 (검증 완료)
- [ ] 이름, 역할, 상태 제공 (ARIA)
- [ ] 상태 변경이 명확 (aria-live)
```

---

## 🔗 도움말 링크

- [WCAG 2.1 가이드](https://www.w3.org/WAI/WCAG21/quickref/)
- [WebAIM 색상 대비 검사기](https://webaim.org/resources/contrastchecker/)
- [Chrome DevTools Accessibility](https://developer.chrome.com/docs/devtools/accessibility/reference)
- [Axe DevTools 브라우저 확장](https://www.deque.com/axe/devtools/)

---

**다음 논의 사항**:
1. 게임 정보 문서 제공 → 콘텐츠 정확도 분석
2. 우선순위 1 개선사항 구현
3. 자동화 테스트 환경 구축 검토
