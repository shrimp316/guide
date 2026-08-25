# 🎮 벽돌주식회사 가이드 — 심층 접근성·편의성 감사 (2차)

**작성일**: 2026년 8월 24일
**방식**: 파일 그룹별 4개 에이전트가 각 HTML 전체를 직접 읽고, WCAG 상대휘도 공식으로 색상 대비를 실측 계산하여 감사. 기존 `ACCESSIBILITY_REPORT.md`(1차, 정적 코드 리뷰)의 주장을 파일·줄 단위로 검증.
**대상**: index.html, calc/ascension.html, calc/dimension-ev.html, calc/forge.html, calc/beast-cal/beast-cal.html, tool/path.html, tool/payment.html, tool/tree/tree.html (전체 8개 파일)

---

## 🚨 사이트 전체를 관통하는 Critical 패턴

1개 파일이 아니라 **거의 모든 파일에서 반복되는 구조적 문제**입니다.

| 패턴 | 해당 파일 | 심각도 |
|---|---|---|
| **핵심 인터랙션이 키보드로 조작 불가능** (plain `<div onclick>`, tabindex/role 없음) | index.html(사이드바+카드 전체), ascension.html(단계 선택 chip), path.html(그리드 289칸 아님, 실제 25칸), tree.html(스킬트리 노드 289개) | **Critical** |
| **모달에 dialog 시맨틱/포커스 트랩/Escape 없음** | index.html, tree.html | **Critical** |
| **홈으로 가는 버튼이 죽어있음** (CSS 클래스만 정의, 마크업엔 없음) | ascension.html, forge.html | **Critical** |
| **탐색 요소가 아예 없는 고립 페이지** | dimension-ev.html (헤딩도, 홈 링크도, `<h1>`도 전무) | **Critical** |
| **입력 검증 부재로 NaN이 화면에 그대로 노출** | ascension.html("NaN분 NaN초"), dimension-ev.html("NaN회") | **High** |
| **문서 전체에 헤딩 태그(`<h1>~<h6>`)가 하나도 없음** | index.html | **Critical** |

---

## 📄 파일별 상세 결과

### 1. index.html

**요약**: 사이드바 네비게이션·홈 카드·게시판 카드가 전부 `<div onclick>`이라 키보드로 단 하나도 열 수 없음. 헤딩 태그 0개. 모달에 dialog 시맨틱 없음.

| 항목 | 실측치 | 판정 |
|---|---|---|
| `--text3` 계열 (nav-group-label, card-tag 등 8곳+) | 2.48~2.86:1 | ❌ AA-large(3:1)조차 미달 |
| CTA 버튼(글 작성/게시하기) 흰글씨-on-teal | 3.39:1 | ❌ |
| 배너 링크(teal-on-teal-light) | 2.98:1 | ❌ |
| 터치 타겟 (햄버거 28×40, 모달닫기 26×26, 태그 27, 사이드바행 35) | 26~37px | ❌ 1차 보고서의 "36px 이상"은 과대평가 |

**1차 보고서 정정**: `--text3` 대비를 "3.8:1"이라 했으나 실측 **2.60~2.86:1**로 더 나쁨. "모든 버튼이 `<button>` 태그"라는 주장은 틀림 — 사이드바 17개 항목 전부 `<div onclick>`.

전체 상세(줄 번호·수정 코드 포함)는 아래 부록 A 참고.

### 2. calc/ascension.html, dimension-ev.html, forge.html

| 파일 | 가장 심각한 발견 |
|---|---|
| **ascension.html** | 홈 버튼 죽음(CSS만 존재), 단계선택 chip 키보드 불가, 투입횟수 미검증 시 **"NaN분 NaN초"** 노출, 결과 숫자 색상(`gold` 2.15:1, `green` 2.54:1) 대비 심각 미달 |
| **dimension-ev.html** | **페이지 전체에 탐색 요소 0개**(홈/뒤로/헤딩 전무), 남은칸 미검증 시 **"NaN회"** 노출, `<option value="81">` 알파·베타가 **같은 값**(복붙 버그로 베타 선택이 무의미) |
| **forge.html** | 홈 버튼 죽음(ascension과 동일 패턴), 13개 "0 처리" 토글 전부 접근성 이름 없음, 토글 실제 클릭영역이 0px(포커스링 안 보임) |

**1차 보고서 정정**: forge.html `--text-dim` "2.2:1"이라는 수치는 틀림 — 실측 **3.79~4.78:1**(배경별로 다르며 훨씬 양호). `#007bff` 2.1:1 예시는 forge.html에 아예 존재하지 않는 색상값(다른 파일과 혼동).

### 3. calc/beast-cal.html, tool/path.html, tool/payment.html

| 파일 | 가장 심각한 발견 |
|---|---|
| **beast-cal.html** | 활성 버튼/목표칩 흰글씨-on-primary 3.00:1, 모바일 CSS `.step-btn` 규칙이 실제 요소(`.step-chip`)와 이름이 달라 **죽은 규칙**(의도한 모바일 터치 확대가 전혀 적용 안 됨) |
| **path.html** | 그리드 25칸(5×5×2)이 **키보드로 완전히 조작 불가**(WCAG 2.1.1 Level A 위반), 등급이 **색상으로만 구분**(색약 사용자 구분 불가), **등급 순환 버튼 버그**: 순환 로직상 "일반(1pt)" 등급에 개별 셀로는 절대 도달 불가 |
| **payment.html** | 결과 CSV 다운로드 함수(`downloadFiltered`)가 **구현은 되어 있으나 어디서도 호출 안 됨**(죽은 기능), 안내 문구는 "벽돌주식회사"(공백없음)인데 실제 필터링 코드는 "벽돌 주식회사"(공백있음)로 검색 — **불일치 시 사용자는 원인을 알 길이 없음** |

**1차 보고서 정정**: beast-cal.html에 `--text-dim: #7a7f99`(2.2:1)이 있다고 했으나 **해당 변수 자체가 beast-cal.html에 존재하지 않음**(forge.html 수치를 잘못 일반화한 것으로 추정). beast-cal 다크테마 텍스트 대부분은 실제로 AA를 통과함. path.html 그리드 셀 크기 "12-14px"도 실측 결과 **22~37px**로 더 큼(문제 방향은 맞으나 수치가 부정확했음).

### 4. tool/tree/tree.html (1.9MB, 스킬트리 빌더)

**구조**: 캔버스가 아니라 DOM(`<div class="cell">`) 289개로 그려짐. 연결선만 캔버스로 오버레이. 파일 크기의 91%(1.78MB)가 인라인 base64 WASM 한 줄.

**바텀라인**: **핵심 기능(트리에 포인트 찍기)이 키보드/스크린리더 사용자에게는 사실상 존재하지 않는 기능**입니다.
- 노드 289개 전부 `click`/`mouseenter`만 있고 `tabindex`/`role`/`aria-*`가 파일 전체에 단 하나도 없음(grep 확인)
- 노드 정보 패널이 `mouseenter`로만 갱신 — 마우스가 없으면 노드가 뭘 하는지 알 방법이 없음
- 모바일 480px 이하에서 클릭 아이콘이 23×23px(WCAG 2.2 최소 24px에도 못 미침)
- `--text-dim`(#3d6644) 계열이 배경별 2.64~2.83:1로 광범위하게 사용되며 미달
- 모달도 index.html과 동일하게 dialog 시맨틱/Escape/포커스 트랩 없음
- 1.78MB WASM을 base64로 인라인 → 매 페이지 로드마다 캐시 불가, 저사양 모바일에서 로딩·배터리 부담

이 파일은 1차 보고서에서 사실상 다뤄지지 않았던 파일입니다.

---

## ✅ 개선 우선순위 (재작성)

### P0 — 지금 당장 (버그, 사용자가 바로 체감)
1. **ascension.html / dimension-ev.html의 NaN 노출** — 입력 검증 추가로 5분 내 수정 가능한데 사용자가 매일 마주칠 문제
2. **dimension-ev.html `<option value="81">` 복붙 버그** — 베타 선택이 실제로 알파와 동일하게 계산되는 정확성 버그
3. **ascension.html / forge.html 홈 버튼 죽음** — CSS는 있는데 마크업에 없어서 해당 계산기에서 나가는 길이 브라우저 뒤로가기뿐
4. **payment.html 문자열 불일치("벽돌주식회사" vs "벽돌 주식회사")** — 필터가 항상 0건일 수 있는데 원인 파악 불가
5. **path.html 등급 순환 버그** — 개별 셀로는 "일반" 등급에 도달 불가

### P1 — 키보드/스크린리더 접근성 (구조적, 시간 소요)
6. index.html 사이드바+카드, ascension.html 단계칩, path.html 그리드, tree.html 노드 289개 — **전부 키보드 조작 불가**를 `<button>` 전환 또는 `tabindex`+`keydown`으로 해결
7. index.html에 `<h1>~<h3>` 헤딩 구조 도입(현재 0개)
8. index.html / tree.html 모달에 `role="dialog"`, `aria-modal`, 포커스 트랩, Escape 처리
9. dimension-ev.html에 홈/헤딩 등 탐색 요소 신설(현재 전무)

### P2 — 색상 대비 (파일별 실측 수치 기준으로 재조정)
10. index.html `--text3`, ascension.html `--text-muted`/결과 숫자색, beast-cal.html 활성 버튼, tree.html `--text-dim`, payment.html `#007bff` — 위 표의 실측 대비값 기준으로 색상 조정 (1차 보고서 수치가 아닌 이 보고서의 실측치 사용)

### P3 — 터치 타겟 / 라벨 / 기타
11. 전 파일 공통: `<label for>` 연결, `aria-live` 결과 영역, 아이콘 버튼 `aria-label`, `:focus-visible` 스타일
12. tree.html: WASM 외부 파일화 + 지연 로딩

---

## 부록: 원본 4개 에이전트 전체 보고서 (줄 번호·수정 코드 스니펫 포함)

각 발견 항목에는 정확한 `파일명:줄번호`, 문제 설명, 수정 코드 스니펫이 포함되어 있습니다.

- [ACCESSIBILITY_AUDIT_index.md](ACCESSIBILITY_AUDIT_index.md) — index.html 전체 감사
- [ACCESSIBILITY_AUDIT_calc.md](ACCESSIBILITY_AUDIT_calc.md) — ascension/dimension-ev/forge.html 전체 감사
- [ACCESSIBILITY_AUDIT_tools.md](ACCESSIBILITY_AUDIT_tools.md) — beast-cal/path/payment.html 전체 감사
- [ACCESSIBILITY_AUDIT_tree.md](ACCESSIBILITY_AUDIT_tree.md) — tree.html 전체 감사
