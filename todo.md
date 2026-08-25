# 남은 작업 TODO

기준 문서: `DESIGN_SPEC.md`

현재 상태:

- [x] Phase 1 — 디자인 토큰 연결 및 P0 버그 수정
- [x] Phase 2 — 라이트/다크 테마와 색상 대비 개선
- [ ] Phase 3 — 구현 및 정적 검증 완료, 실제 브라우저 키보드 검증 필요
- [ ] Phase 4 — 홈 대시보드 재구성 및 게임 스타일 적용
- [ ] Phase 5 — 최종 접근성·브라우저·반응형 검증

## 사전 준비

- [ ] Codex의 **Settings → Computer use**에서 Chrome 브라우저 확장 연결
- [ ] 프로젝트 루트에서 로컬 정적 서버 실행
- [ ] 변경 중인 8개 HTML과 `css/design-system.css`가 서버에서 정상 로드되는지 확인
- [ ] 기존 미커밋 변경을 보존하고 작업 전 `git status --short` 기록

## Phase 3 마무리 — 실제 키보드 검증

정적 구현과 JavaScript 구문 검사는 통과한 상태다. 아래 항목을 실제 브라우저에서 마우스 없이 확인한 후 `DESIGN_SPEC.md`의 Phase 3을 완료 처리한다.

### 공통

- [ ] 모든 핵심 기능에 Tab/Shift+Tab으로 도달
- [ ] 포커스 링이 모든 조작 요소에서 명확하게 표시
- [ ] Enter/Space가 클릭과 동일하게 동작
- [ ] 포커스 순서가 화면의 읽기 순서와 일치
- [ ] 숨겨진 패널이나 모달 내부 요소에 포커스가 들어가지 않음

### 페이지별

- [ ] `index.html`: 사이드바, 홈 카드, 게시글 카드가 키보드로 열림
- [ ] `index.html`: 글 상세/글쓰기 모달에서 Tab 포커스 트랩, Escape 닫기, 호출 버튼으로 포커스 복귀
- [ ] `calc/ascension.html`: 단계 버튼 선택 및 계산 실행
- [ ] `calc/dimension-ev.html`: 입력·계산·결과 안내 확인
- [ ] `calc/forge.html`: 좌우 방향키/Home/End 탭 전환, 토글, 계산 실행
- [ ] `calc/beast-cal/beast-cal.html`: 단계 선택, 필터, 결과 요약 펼치기/접기
- [ ] `tool/path.html`: 방향키 셀 이동, Enter/Space 적용, Shift+Enter 등급 순환
- [ ] `tool/payment.html`: 파일 선택, 계산, CSV 다운로드 버튼 접근
- [ ] `tool/tree/tree.html`: 노드 이동·선택, 정보 패널 갱신, 가이드 모달 포커스 관리
- [ ] 검증 통과 후 `DESIGN_SPEC.md` Phase 3 체크박스를 `[x]`로 변경

## Phase 4 — 홈 재구성 및 게임 느낌

### 홈 대시보드 구조

- [ ] `index.html`의 기존 전체 카테고리 카드 목록과 사이드바 중복 제거
- [ ] `grid-guide`, `grid-strategy`, `grid-tool` 전체 나열 제거
- [ ] 공지 고정 카드 영역을 최근 업데이트 3~4개 영역으로 교체
- [ ] 계산기 4종을 아이콘 기반 빠른 실행 버튼으로 구성
- [ ] 건의게시판 최신 글 3개 미리보기와 더보기 버튼 추가
- [ ] 빈 게시글·업데이트 데이터에 대한 대체 화면 제공
- [ ] 홈 대시보드의 제목 계층을 `h1` → `h2` 순서로 유지

### 게임 스타일

- [ ] 브랜드 초록과 골드 악센트를 장식 역할에만 사용
- [ ] 헤더 또는 히어로 영역에 게임 가이드 느낌을 주는 시각 요소 적용
- [ ] 기존 라이트/다크 페이지의 개별 정체성 유지
- [ ] 과도한 그라디언트·발광·애니메이션 사용 방지
- [ ] 새 애니메이션과 전환 효과가 `prefers-reduced-motion`에서 비활성화되는지 확인
- [ ] 360px, 480px, 768px, 데스크톱 너비에서 레이아웃 확인

### Phase 4 완료 조건

- [ ] 홈에서 사이드바와 같은 전체 카테고리 목록이 다시 나열되지 않음
- [ ] 최근 업데이트·빠른 실행·게시판 미리보기가 각각 다른 목적의 UI로 구분됨
- [ ] 키보드 및 스크린리더 접근성이 Phase 3 수준에서 퇴행하지 않음
- [ ] 조건 충족 후 `DESIGN_SPEC.md` Phase 4 체크박스를 `[x]`로 변경

## Phase 5 — 최종 검증 및 수정 반복

### 자동 검사

- [ ] 8개 HTML의 inline JavaScript 구문 검사
- [ ] `git diff --check` 통과
- [ ] 잘못된 `design-system.css` 상대경로가 없는지 확인
- [ ] 클릭 가능한 비시맨틱 `div`/`span` 재검색
- [ ] 연결되지 않은 `<label>`과 접근성 이름 없는 입력 재검색
- [ ] 중복 `id`, 잘못된 `aria-controls`/`aria-labelledby` 재검색
- [ ] 최종 텍스트·배경 색상 대비 재계산

### Lighthouse

다음 5개 페이지에서 Accessibility 95점 이상을 목표로 한다.

- [ ] `index.html`
- [ ] `calc/ascension.html`
- [ ] `calc/forge.html`
- [ ] `calc/beast-cal/beast-cal.html`
- [ ] `tool/path.html`
- [ ] Performance 85+ 확인
- [ ] Best Practices 90+ 확인
- [ ] 실패 항목 수정 후 재실행

### 수동 브라우저 QA

- [ ] Chrome 데스크톱
- [ ] 모바일 뷰포트 또는 Chrome 모바일 에뮬레이션
- [ ] 가능하면 Firefox와 Safari/iOS Safari 추가 확인
- [ ] 모달 열기·닫기와 포커스 복귀
- [ ] 계산기 정상값·빈 값·음수·경계값 입력
- [ ] 긴 텍스트와 작은 화면에서 잘림·가로 스크롤 확인
- [ ] 차트·그리드·트리의 대체 정보와 상태 변화 확인

### 최종 마무리

- [ ] 발견된 문제를 수정하고 자동·수동 검증 반복
- [ ] `ACCESSIBILITY_REPORT.md`에 최종 결과와 잔여 제한사항 기록
- [ ] `DESIGN_SPEC.md` Phase 5 체크박스를 `[x]`로 변경
- [ ] 최종 `git status`와 변경 파일 목록 검토
- [ ] 사용자 승인 후 커밋

## 현재 알려진 제한사항

- 실제 브라우저 키보드 트레이스와 Lighthouse는 브라우저 연결 전까지 수행할 수 없음
- `tool/tree/tree.html`의 대형 인라인 WASM 외부화는 Phase 3 접근성 범위에서 제외됨. 성능 개선 작업으로 별도 진행 필요
- 현재 변경사항은 아직 커밋되지 않았으므로 기존 작업을 덮어쓰거나 초기화하지 말 것
