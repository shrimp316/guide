# 벽돌주식회사 가이드 성능·구조 리팩토링 기술명세

> 문서 상태: Draft 1.0  
> 작성일: 2026-08-25  
> 대상: 정적 HTML 기반 가이드·계산기 사이트  
> 우선 목표: 배포 검수 및 초기 로딩 비용 절감, 기능 호환성 유지

## 1. 배경

현재 사이트는 `index.html`을 셸(shell)로 사용하고 계산기와 도구를 별도 HTML 문서로 제공한다. 각 계산기와 도구는 사용자가 메뉴를 선택할 때 빈 `iframe`의 `src`를 설정하는 방식으로 지연 로드되므로, 모든 계산기가 홈 문서에 결합된 구조는 아니다.

확인된 주요 병목은 다음과 같다.

| 항목 | 현재값 | 문제 |
|---|---:|---|
| 전체 배포 파일 | 약 4.72MB / 121개 | 정적 호스팅 검수 대상 전체 크기 |
| `index.html` | 61,128B / 1,114줄 | 게시판 코드, 스타일, 앱 셸 코드가 한 파일에 혼재 |
| `tool/tree/tree.html` | 1,954,091B | 전체 배포 크기의 약 40% |
| 내장 Brotli WASM Base64 | 1,862,940자 | HTML 파싱·소스 검사·변경 검수 비용 증가 |
| 디코딩된 WASM | 약 1,397,203B | 실제 UID 내보내기 전에는 필요하지 않음 |
| 신수 이미지 | 약 1.60MB / 33개 | 원본 PNG 중심, 전송량 최적화 여지 |
| 진리의 나무 이미지 | 약 520KB / 58개 | 도구 진입 시 다수 이미지 요청 가능 |

또한 홈 문서가 로드될 때 Firebase SDK와 Quill 리소스를 즉시 요청한다. 게시판, 로그인 또는 편집 기능을 사용하지 않는 방문자에게는 불필요한 초기 비용이다.

## 2. 목표와 성공 지표

### 2.1 목표

1. 홈과 개별 계산기의 현재 동작 및 URL 해시 라우팅을 유지한다.
2. 거대한 Base64 바이너리를 HTML에서 제거해 소스 검수와 파싱 비용을 줄인다.
3. Firebase, Quill, WASM을 실제 기능 사용 시점까지 로드하지 않는다.
4. 기능별 책임을 파일 단위로 분리해 변경 영향 범위와 캐시 무효화 범위를 줄인다.
5. 빌드 도구 없이 정적 파일 서버에서 계속 배포할 수 있게 한다.

### 2.2 측정 가능한 완료 기준

| 지표 | 목표값 |
|---|---:|
| `tool/tree/tree.html` 크기 | 120KB 이하 |
| `index.html` 크기 | 40KB 이하(모듈 분리 완료 후) |
| 홈 최초 로드의 WASM 요청 | 0건 |
| 진리의 나무 진입 직후 WASM 요청 | 0건 |
| UID 내보내기 최초 실행 시 WASM 요청 | 1건 이하 |
| 홈 최초 로드의 Quill JS/CSS 요청 | 0건 |
| 게시판 미진입 상태의 Firestore·Storage 요청 | 0건 |
| 동일 UID 입력에 대한 출력 문자열 | 리팩토링 전과 바이트 단위 동일 |
| 기존 계산기 핵심 회귀 테스트 | 100% 통과 |

외부 CDN, 폰트 및 Firebase API의 응답 시간은 성공 지표에 포함하지 않는다. 요청 발생 여부와 프로젝트 소유 정적 리소스 크기를 기준으로 판단한다.

## 3. 범위

### 3.1 포함 범위

- `tool/tree/tree.html`의 Brotli WASM 외부화 및 지연 초기화
- `index.html`의 Firebase·Quill 선택적 로딩
- 홈 셸의 CSS, 라우팅 코드, 게시판 코드 분리
- 진리의 나무 이미지 지연 디코딩
- 주요 이미지 포맷 최적화는 별도 단계로 수행
- 로딩·실패·재시도 상태 정의
- 자동 및 수동 회귀 검증 절차 추가

### 3.2 제외 범위

- 계산 공식, 진리의 나무 최적 경로 알고리즘 변경
- Firebase 데이터 모델 및 보안 규칙 변경
- UI 디자인 전면 개편
- SPA 프레임워크 도입
- npm, Vite, Webpack 등 필수 빌드 파이프라인 도입
- 게시글 데이터 마이그레이션
- 기존 페이지 URL 및 해시 식별자 변경

게시글 본문을 `innerHTML`로 표시하는 기존 콘텐츠 정제 정책은 별도 보안 개선 과제로 관리한다. 이번 구조 리팩토링에서 해당 동작을 확대하거나 악화시키지 않는다.

## 4. 설계 원칙

1. **행동 호환성 우선**: 파일 경계는 변경하되 계산 결과와 사용자 흐름은 변경하지 않는다.
2. **사용 시점 로딩**: 네트워크와 초기화 비용은 해당 기능을 처음 사용할 때만 발생시킨다.
3. **단일 초기화 보장**: 동적 로더는 진행 중인 `Promise`를 캐시해 중복 클릭에도 요청과 초기화가 한 번만 수행되게 한다.
4. **점진적 적용**: 단계마다 독립 배포 및 롤백이 가능해야 한다.
5. **정적 호스팅 호환**: 상대 경로와 올바른 MIME 응답만으로 동작해야 한다.
6. **관찰 가능한 실패**: 로딩 실패는 콘솔에 원인을 남기고 사용자에게 재시도 가능한 메시지를 제공한다.

## 5. 목표 파일 구조

```text
/
├─ index.html
├─ css/
│  ├─ design-system.css
│  └─ index.css
├─ js/
│  ├─ app.js
│  ├─ board.js
│  ├─ firebase-client.js
│  └─ quill-loader.js
├─ calc/
│  └─ ... 기존 계산기 HTML 유지
└─ tool/
   └─ tree/
      ├─ tree.html
      ├─ tree.js
      ├─ tree.css
      ├─ brotli-loader.js
      ├─ vendor/
      │  └─ brotli_wasm_bg.wasm
      └─ images/
```

`tree.js`와 `tree.css` 분리는 WASM 외부화가 안정화된 뒤 수행한다. 첫 번째 변경에서 파일 이동을 과도하게 늘리지 않는다.

## 6. 상세 기술 설계

### 6.1 Brotli WASM 외부화

#### 현재 문제

`tool/tree/tree.html`의 `_WASM_B64` 상수에 WASM 전체가 Base64 문자열로 포함되어 있다. 브라우저는 UID 내보내기를 사용하지 않아도 HTML 소스와 거대한 문자열을 내려받고 파싱해야 한다.

#### 변경 사항

1. `_WASM_B64`를 디코딩하여 `tool/tree/vendor/brotli_wasm_bg.wasm`으로 저장한다.
2. `_initWasm()`의 `atob()` 및 문자 단위 복사 코드를 제거한다.
3. `_initWasm()`은 최초 호출 시 `.wasm`을 `fetch()`한다.
4. 서버가 `application/wasm`을 제공하면 `WebAssembly.instantiateStreaming()`을 사용한다.
5. 스트리밍 호출 전에 fallback용 `Response.clone()`을 확보한다. `Content-Type`이 `application/wasm`이 아니거나 API 미지원·MIME 관련 `TypeError`가 발생한 경우에만 clone의 `arrayBuffer()`와 `WebAssembly.instantiate()`로 폴백한다.
6. `WebAssembly.CompileError`, `LinkError`, `RuntimeError` 및 import object 불일치는 같은 바이너리로 재시도해도 해결되지 않으므로 폴백하지 않고 원래 오류를 보고한다.
7. import object 및 `_wasm.compress()` 어댑터의 공개 동작은 유지한다.
8. 추출 전 Base64 디코딩 결과와 외부 `.wasm`의 SHA-256을 비교하고 해시를 검증 기록에 남긴다.

#### 로더 계약

```js
let wasmInstance = null;
let wasmLoadPromise = null;

export function ensureBrotli() {
  if (wasmInstance) return Promise.resolve(wasmInstance);
  if (wasmLoadPromise) return wasmLoadPromise;
  wasmLoadPromise = loadBrotliWasm()
    .then(instance => (wasmInstance = instance))
    .catch(error => {
      wasmLoadPromise = null;
      throw error;
    });
  return wasmLoadPromise;
}
```

- 동시에 여러 번 호출해도 네트워크 요청은 하나만 발생해야 한다.
- 실패 후 다시 UID 내보내기를 누르면 재시도할 수 있어야 한다.
- 성공한 인스턴스는 해당 iframe 생명주기 동안 재사용한다.
- `encodeIngameUID_TT()`의 반환 형식 `*TT*{base64}*`는 변경하지 않는다.

#### 호스팅 요구사항

- `.wasm` 응답의 권장 `Content-Type`은 `application/wasm`이다.
- 정적 호스팅에서 MIME 설정을 제어할 수 없을 경우에도 arrayBuffer 폴백으로 동작해야 한다.
- WASM 경로는 `tree.html` 기준 상대 경로 `./vendor/brotli_wasm_bg.wasm`을 사용한다.
- 장기 캐시 사용 시 파일 내용 변경마다 파일명 해시 또는 쿼리 버전을 갱신한다.

### 6.2 Firebase 지연 로딩

#### 현재 문제

`index.html` 상단 모듈이 Firebase App, Auth, Firestore, Storage를 즉시 import하고 인증 상태 감시를 시작한다. 홈 또는 계산기만 사용하는 경우에도 SDK 다운로드와 초기화가 발생한다.

#### 모듈 책임

| 모듈 | 책임 |
|---|---|
| `js/firebase-client.js` | Firebase 앱 단일 초기화, 필요한 서비스 반환 |
| `js/board.js` | 게시글 조회·작성·수정·삭제 및 게시판 렌더링 |
| `js/app.js` | 라우팅, 카드, iframe, 모달 셸과 로더 호출 |

#### 로딩 시점

- 게시판 가이드 진입: App + Auth + Firestore를 함께 로드한 뒤 사용자 권한을 확정하고 목록 렌더링
- 로그인 버튼 클릭: App + Auth 로드
- 인증이 필요한 게시판 동작: Auth가 없으면 그 시점에 로드
- 이미지 업로드 선택: Storage를 그 시점에 로드
- 홈 및 계산기 iframe 진입: Firebase 모듈을 로드하지 않음. 단, 아래의 redirect pending 상태가 있는 복귀 요청에서는 Auth만 예외적으로 로드

모바일 리디렉션 로그인 직전에는 `sessionStorage`에 인증 진행 상태를 저장한다. 복귀 페이지는 이 상태가 있을 때 Auth 모듈을 즉시 초기화하고 `getRedirectResult()`를 처리한 뒤 상태를 제거한다. 이 흐름을 구현하기 어렵다면 Auth만 `requestIdleCallback()` 이후 불러오는 방식을 대안으로 사용하되, Firestore와 Storage는 계속 지연 로딩한다.

#### 호환성 계약

- 기존 `loadBoard(category)` 호출부는 마이그레이션 동안 어댑터를 통해 유지할 수 있다.
- 인증 완료 후 현재 게시판을 다시 불러오는 동작을 유지한다.
- 익명 글 비밀번호 해시 및 관리자 판별 로직은 변경하지 않는다.
- Firebase SDK는 현재 `10.12.2`로 고정하며 리팩토링과 버전 업그레이드를 동시에 수행하지 않는다.
- Firebase 설정값은 클라이언트 공개 설정으로 유지하되 보안 권한으로 오인하지 않는다. 실제 접근 통제는 기존 Firebase Security Rules가 담당한다.

#### 비동기 화면 전환 계약

- `board.js` import Promise와 Firebase 초기화 Promise는 공유하되, 게시판 조회마다 증가하는 `requestToken`을 발급한다.
- Firestore 조회는 취소할 수 없더라도 응답 시점에 `requestToken`, 현재 해시 페이지, 요청 category가 모두 일치할 때만 DOM을 갱신한다.
- 사용자가 계산기나 다른 게시판으로 이동한 뒤 도착한 이전 응답은 렌더링하지 않는다.
- 로딩 및 오류 상태도 현재 요청과 일치할 때만 표시한다.
- 동시에 진행 중인 동일 category 조회 Promise는 공유한다. 완료 결과의 장기 캐시 여부는 별도 정책으로 결정한다.

### 6.3 Quill 지연 로딩

#### 현재 문제

에디터 인스턴스는 모달을 열 때 생성하지만 Quill JS와 CSS 자체는 홈에서 즉시 로드된다.

#### 변경 사항

- `index.html`의 Quill `<script>`와 `<link>`를 제거한다.
- `js/quill-loader.js`가 CSS `<link>` 삽입과 JS 로딩을 담당한다.
- 글쓰기 또는 수정 모달을 처음 열기 직전에 `await ensureQuill()`을 호출한다.
- 로딩 중에는 제출 및 편집 영역을 비활성화하고 상태 문구를 표시한다.
- 로드 실패 시 모달은 닫지 않고 재시도 버튼 또는 다시 열기 동작으로 복구 가능해야 한다.

#### 단일 초기화 조건

- Quill CSS와 JS 태그는 각각 최대 한 개만 생성한다.
- 모달을 반복해서 열어도 동일 에디터를 안전하게 재사용하거나 기존 인스턴스를 명시적으로 정리한다.
- 전역 `window.Quill` 존재 여부만으로 완료를 판정하지 않고 로더 Promise를 캐시한다.

### 6.4 홈 셸 모듈 분리

#### `index.html`에 남길 내용

- 문서 메타데이터와 manifest
- 접근성상 필요한 정적 앱 셸 마크업
- `css/design-system.css`, `css/index.css`
- `<script type="module" src="js/app.js"></script>`

#### `js/app.js`로 이동할 내용

- `CARDS`, `IFRAME_PAGES`, `GUIDES`
- `navigate()`, `showPage()` 및 브라우저 history 처리
- 카드 렌더링과 필터
- 배너와 토스트
- 공통 모달 열기·닫기 및 이벤트 연결

#### `js/board.js`로 이동할 내용

- 게시판 조회와 렌더링
- 글 상세, 작성, 수정, 삭제
- 비밀번호 해시와 관리자 확인
- 이미지 업로드 연동

인라인 이벤트 속성은 단계적으로 `addEventListener()`로 교체한다. 첫 단계에서 모두 제거할 필요는 없지만 모듈 분리 완료 시 HTML이 전역 함수 존재에 의존하지 않게 한다.

#### 모듈 부트 및 이벤트 계약

현재 HTML의 인라인 핸들러는 `navigate()` 등 일반 스크립트 전역 함수에 의존한다. ES module 최상위 함수는 `window`에 노출되지 않으므로 Phase 3의 모듈 전환과 해당 인라인 핸들러 제거는 하나의 원자적 변경으로 배포한다.

부트 순서는 다음과 같이 고정한다.

1. `DOMContentLoaded` 이후 `app.js`가 정적 DOM 이벤트와 이벤트 위임 핸들러를 모두 등록한다.
2. 카드와 동적 요소를 생성하고 각 요소에 모듈 내부 이벤트를 연결한다.
3. 최초 URL 해시를 읽어 `showPage()`를 한 번 실행한다.
4. 게시판 전용 동작은 이벤트 발생 시 `board.js`를 import하고 완료된 모듈의 export 함수를 직접 호출한다.
5. `window.openWriteModal` 같은 임시 전역 어댑터가 필요하면 Phase 3 내부에서만 사용하고 Phase 완료 전에 제거한다.

Phase 3 완료 시 HTML의 인라인 `onclick`, `onchange`, `onkeydown`은 0개여야 하며, 모듈 import 전 사용자 클릭에도 `ReferenceError`가 발생하지 않아야 한다.

### 6.5 iframe 라우팅

현재 계산기·도구 지연 로딩은 유지한다.

- iframe 초기 `src`는 비어 있어야 한다.
- `showPage()`가 계산기 또는 도구를 선택했을 때만 대응 URL을 설정한다.
- 같은 페이지 재방문 시 불필요한 재요청과 상태 초기화를 하지 않는다.
- 다른 도구로 이동하면 iframe 문서를 교체하되 기존 history와 뒤로 가기 동작을 유지한다.
- 허용된 페이지는 고정된 `IFRAME_PAGES` 맵에서만 선택하며 사용자 입력을 `src`에 직접 사용하지 않는다.

### 6.6 이미지 최적화

이미지 최적화는 기능 리팩토링과 분리해 수행한다.

1. 신수 및 진리의 나무 원본을 보존한 상태에서 WebP 후보를 생성한다.
2. 시각 비교 후 품질 저하가 없는 파일만 교체한다.
3. 동적으로 생성하는 `<img>`에 `loading="lazy"`, `decoding="async"`, 명시적 크기를 적용한다.
4. 동일 이미지의 파일명과 상대 경로 변경은 매핑 테이블과 함께 한 변경으로 처리한다.
5. PWA 아이콘은 manifest 요구 크기를 유지하되 무손실 최적화를 적용한다.

## 7. 오류 처리와 사용자 상태

| 상황 | 사용자 표시 | 내부 처리 |
|---|---|---|
| WASM 로딩 중 | “UID 생성 중…” | 중복 요청 방지, 버튼 일시 비활성화 |
| WASM 로딩 실패 | “UID 모듈을 불러오지 못했습니다. 다시 시도해 주세요.” | 원인과 URL을 `console.error`, Promise 초기화 |
| Firebase 로딩 실패 | “게시판 연결에 실패했습니다.” | 페이지 셸 유지, 재시도 허용 |
| Quill 로딩 실패 | “편집기를 불러오지 못했습니다.” | 입력 데이터 유지, 다시 열기 허용 |
| 이미지 로딩 실패 | 대체 텍스트 또는 기존 이모지 | 레이아웃 크기 유지 |

오류 메시지에 Firebase 내부 경로, 스택 또는 사용자 데이터는 노출하지 않는다.

## 8. 마이그레이션 계획

### Phase 0 — 기준선 고정

- 대표 계산 입력과 결과를 기록한다.
- 진리의 나무 대표 활성 노드 집합과 생성 UID를 골든 데이터로 저장한다.
- 홈, 게시판, 각 iframe의 네트워크 요청 목록과 파일 크기를 기록한다.
- 현재 브라우저 콘솔 오류를 별도로 기록해 신규 회귀와 구분한다.

완료 조건: 리팩토링 전 동작을 재현할 수 있는 체크리스트와 골든 데이터가 존재한다.

### Phase 1 — WASM 외부화

- Base64를 `.wasm`으로 추출한다.
- 추출 전후 WASM SHA-256이 동일한지 확인한다.
- 단일 초기화 로더와 streaming/fallback 경로를 구현한다.
- UID 출력 호환성과 실패 후 재시도를 검증한다.

완료 조건: `tree.html` 120KB 이하, 도구 진입 시 WASM 요청 0건, UID 내보내기 시 결과 동일.

롤백 단위: `tree.html`, `brotli-loader.js`, `vendor/brotli_wasm_bg.wasm` 변경만 되돌린다.

### Phase 2 — Firebase·Quill 지연 로딩

- Firebase 서비스별 로더를 추가한다.
- 게시판 진입, 로그인, 업로드 시점으로 초기화를 이동한다.
- Quill JS/CSS를 모달 진입 시점으로 이동한다.

완료 조건: 홈과 계산기 진입에서 Quill·Firestore·Storage 요청이 없고 게시판 CRUD와 로그인이 유지된다.

롤백 단위: 동적 로더를 제거하고 기존 상단 import 및 리소스 태그를 복원한다.

### Phase 3 — 홈 CSS·JS 모듈 분리

- `index.css`, `app.js`, `board.js`를 생성한다.
- 전역 함수 연결을 제거하고 명시적 import/export로 전환한다.
- DOM 준비 이후 이벤트 등록 순서를 고정한다.

완료 조건: `index.html` 40KB 이하, 직접 URL/해시 진입 및 뒤로 가기 정상.

### Phase 4 — 이미지 최적화

- 이미지별 WebP 변환 전후 크기와 시각 품질을 비교한다.
- lazy loading 및 명시적 크기를 적용한다.
- 이미지 매핑 누락을 자동 검사한다.

완료 조건: 깨진 이미지 0건, 레이아웃 이동 증가 없음, 이미지 총량 감소.

## 9. 검증 명세

### 9.1 자동 정적 검사

- 모든 로컬 `src`와 `href`가 실제 파일을 가리키는지 검사한다.
- HTML 문서의 중복 ID와 닫히지 않은 태그를 검사한다.
- JavaScript 구문 오류를 검사한다.
- `_WASM_B64` 및 `data:application/wasm` 문자열이 저장소에 남지 않았는지 검사한다.
- `tree.html`과 `index.html`의 크기 예산을 검사한다.
- 배포 파일에 100KB를 초과하는 단일 텍스트 라인이 없는지 검사한다.

### 9.2 기능 회귀

- 득도·승천, 제련, 신수, 차원탐사 계산기의 대표 최소·중간·최대 입력 결과 비교
- 진리의 나무 수동 노드 활성화·비활성화와 포인트 합계 비교
- 진리의 나무 자동 추천 결과 비교
- 대표 활성 노드 집합 3개 이상에 대한 UID 문자열 완전 일치
- UID 복사 성공 및 Clipboard API 실패 폴백 확인
- 게시판 목록, 상세, 작성, 수정, 삭제 확인
- 익명 비밀번호 및 관리자 권한 흐름 확인
- 이미지 업로드 성공·실패 확인
- Google 로그인 팝업·리디렉션 및 카카오톡 인앱 브라우저 안내 확인
- 느린 Firestore 응답 전에 다른 페이지로 이동했을 때 이전 결과가 현재 화면을 덮어쓰지 않는지 확인

#### 회귀 fixture 계약

기준 데이터는 다음 파일에 저장한다.

```text
tests/
├─ fixtures/
│  ├─ calculators.json
│  ├─ tree-paths.json
│  └─ tree-uids.json
└─ MANUAL_QA.md
```

- `calculators.json`: 계산기 식별자, DOM 입력값, 실행 동작, 기대 표시 문자열을 저장한다. 사용자에게 표시되는 결과는 공백과 단위를 포함해 문자열 완전 일치로 판정한다.
- `tree-paths.json`: 총 포인트, 목표, 활성 노드 좌표 집합, 기대 합계와 요약을 저장한다. 표시 문자열은 완전 일치하며 내부 부동소수점 값을 직접 비교하는 검사를 추가할 경우 상대 오차 `1e-9` 이하를 허용한다.
- `tree-uids.json`: 활성 노드 좌표 집합과 기대 UID를 저장하고 byte-for-byte로 비교한다. 최소·중간·최대에 가까운 3개 이상의 fixture를 둔다.
- `MANUAL_QA.md`: 브라우저, 뷰포트, 실행일, 실행자, 시나리오별 통과 여부와 증적 경로를 기록한다.

현재 테스트 러너가 없으므로 Phase 0에서 fixture를 먼저 확정한다. 이후 자동화 방식이 정해질 때까지 “100% 통과”는 위 fixture의 모든 자동 비교 통과와 `MANUAL_QA.md` 필수 항목의 모두 통과를 의미한다.

### 9.3 네트워크 검증

개발자 도구에서 캐시를 비운 뒤 다음을 확인한다.

| 시나리오 | 반드시 없어야 하는 요청 | 발생해야 하는 요청 |
|---|---|---|
| 홈 진입 | WASM, Quill, Firestore, Storage | `index.html`, 공통 CSS, 앱 셸 JS |
| 계산기 진입 | WASM, Quill, Firestore, Storage | 선택한 계산기 HTML과 필요 자산 |
| 진리의 나무 진입 | WASM, Quill, Firebase | `tree.html`, 필요한 스타일·이미지 |
| UID 내보내기 최초 실행 | 중복 WASM 요청 | WASM 1건 |
| 글쓰기 모달 최초 실행 | 중복 Quill 태그 | Quill JS/CSS 각 1건 |
| 게시판 진입 | Storage 선로딩 | Firestore 관련 모듈 |

### 9.4 수동 브라우저 범위

- 최신 Chrome 및 Edge 데스크톱
- Android Chrome 또는 카카오톡 인앱 브라우저
- 모바일 너비 360px 및 데스크톱 1280px 이상
- 느린 3G 시뮬레이션에서 로딩·실패 메시지 확인
- 정적 파일 서버를 통한 실행 필수(`file://` 직접 실행은 검증 대상 아님)

## 10. 배포 및 롤백

1. 각 Phase는 별도 커밋과 별도 배포 미리보기로 검증한다.
2. WASM 파일이 배포 산출물에 포함되었는지 먼저 확인한다.
3. 배포 응답 헤더에서 `.wasm`의 MIME과 캐시 정책을 확인한다.
4. 기능 플래그가 없는 정적 사이트이므로 한 Phase에서 변경 파일 수를 제한한다.
5. 오류율 또는 핵심 기능 회귀가 발견되면 해당 Phase 전체를 되돌린다. 데이터 모델을 변경하지 않으므로 데이터 롤백은 필요하지 않다.

## 11. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| 호스팅의 WASM MIME 미지원 | streaming 초기화 실패 | arrayBuffer 폴백 필수 |
| 상대 경로 오류 | iframe 또는 WASM 404 | 정적 링크 검사와 배포 미리보기 |
| 동적 import 중복 | SDK 중복 초기화·이벤트 중복 | Promise 및 앱 인스턴스 캐시 |
| Firebase 인증 감시 지연 | 로그인 UI가 늦게 갱신 | 로그인/게시판 진입 시 명시적 초기화 상태 표시 |
| Quill 재초기화 | 이벤트 중복·내용 손실 | 단일 인스턴스 정책과 모달 생명주기 테스트 |
| UID 압축 결과 변경 | 게임 호환성 손상 | 골든 UID 바이트 완전 일치 테스트 |
| 이미지 포맷 브라우저 호환 | 이미지 미표시 | 필요 시 `<picture>`와 원본 폴백 |
| 기존 미커밋 변경과 충돌 | 사용자 작업 손상 | Phase별 대상 파일 확인, 관련 없는 변경 보존 |

## 12. 구현 작업 분해

### P0 — 반드시 먼저 수행

- [ ] 리팩토링 전 계산·UID 골든 데이터 작성
- [ ] `_WASM_B64`를 외부 `.wasm`으로 추출
- [ ] WASM 단일 초기화 및 재시도 로더 구현
- [ ] MIME 폴백 및 사용자 오류 상태 구현
- [ ] UID 완전 일치와 네트워크 요청 수 검증

### P1 — 초기 홈 비용 절감

- [ ] Firebase App/Auth/Firestore/Storage 지연 로더 구현
- [ ] 게시판 진입 시 `board.js` 동적 import
- [ ] Quill JS/CSS 지연 로더 구현
- [ ] 로그인·게시판 CRUD·업로드 회귀 검증

### P2 — 유지보수 구조 개선

- [ ] `index.css` 분리
- [ ] `app.js`와 `board.js` 분리
- [ ] `tree.css`, `tree.js`, `brotli-loader.js` 분리
- [ ] 인라인 이벤트를 모듈 이벤트 등록으로 교체
- [ ] 파일 크기 및 정적 링크 자동 검사 추가

### P3 — 전송량 최적화

- [ ] 신수·진리의 나무 이미지 WebP 후보 생성 및 비교
- [ ] `loading="lazy"`, `decoding="async"`, 크기 속성 적용
- [ ] PWA 아이콘 무손실 최적화
- [ ] 최종 배포 크기와 네트워크 워터폴 기록

## 13. 최종 인수 조건

다음 조건을 모두 충족해야 리팩토링을 완료로 판정한다.

- [ ] 기존 계산기와 진리의 나무 결과가 기준선과 동일하다.
- [ ] 기존 게시판 CRUD, 인증 및 이미지 업로드가 정상이다.
- [ ] 기존 URL과 해시 라우팅, iframe 샌드박스 정책이 유지된다.
- [ ] 홈에서는 WASM, Quill, Firestore, Storage가 요청되지 않는다.
- [ ] WASM은 UID 내보내기 최초 실행 시 한 번만 요청된다.
- [ ] `tree.html`은 120KB 이하, `index.html`은 40KB 이하이다.
- [ ] 모든 로컬 자산 경로가 유효하고 콘솔에 신규 오류가 없다.
- [ ] 모바일과 데스크톱 수동 QA를 통과한다.
- [ ] 각 Phase별 롤백 지점과 검증 결과가 기록되어 있다.

## 14. 후속 선택 사항

배포 서비스가 HTML뿐 아니라 모든 정적 파일을 매번 심층 검사하여 여전히 검수가 느리다면, `tool/tree`의 WASM 및 이미지 자산을 별도 정적 배포 또는 CDN으로 이전하는 방안을 검토한다. 이 선택은 캐시와 CORS 정책이 추가되므로 본 리팩토링 완료 후 실제 검수 시간 측정 결과를 근거로 결정한다.
