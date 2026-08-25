# Deep Accessibility & Usability Audit — `index.html`

Full 1040-line file read in its entirety (verified via `Read`, cross-checked with `Grep` for `onclick=`, `role=`, `aria-`, `tabindex`, `<h[1-6]`, `Escape`, `keydown`, `<label`, `<nav`, `<main`). Contrast ratios computed with the actual WCAG relative-luminance formula (not eyeballed) — script and full output below.

## Summary Table

| Area | Verdict | Severity |
|---|---|---|
| Keyboard reachability of primary nav/cards | Completely broken — plain `<div>`s, no `tabindex`, no key handlers | **Critical** |
| Heading structure | Zero `<h1>`–`<h6>` in the entire document | **Critical** |
| Modals (post/write) | No `role="dialog"`, no focus trap, no Escape, no focus return | **Critical** |
| Color contrast (`--text3` family) | 2.48–2.86:1, used in 8+ widely-used classes | **High** |
| CTA button contrast (write/submit) | 3.39:1 (white-on-teal, 13–14px) | **High** |
| Icon-only buttons (✕, ☰) | No accessible name at all | **High** |
| Form labels | `<label>` present but never programmatically linked (`for`) | **High** |
| Live feedback (toast, validation) | No `aria-live`, silent to screen readers | **High** |
| SPA route announcements | `document.title` never updates on navigate() | **High** |
| Touch target sizes | Most buttons 26–37px, not 36–40px as existing report claims | **Medium** |
| Reduced motion | Two infinite animations, no `prefers-reduced-motion` | **Medium** |
| `aria-pressed` on tag filters | Missing | **Medium** |
| Search input label | Placeholder-only | **Medium** |
| Skip-to-content link | Absent | **Low** |
| `lang="ko"` / viewport / landmarks | Correct | ✅ Pass |

Computed contrast ratios (relative luminance formula):

```
Pair                                                                    Ratio  AA-normal(4.5)  AA-large/UI(3.0)
text on bg (body default)                                              15.96  PASS            PASS
text on surface (card-name/modal-title, white bg)                      17.57  PASS            PASS
text2 on surface (card-desc/field label/post-action-btn)                5.51  PASS            PASS
text2 on bg (guide-desc)                                                 5.00  PASS            PASS
text3 on surface (site-sub/nav-group-label/empty-board/                  2.86  FAIL            FAIL
   post-card-meta/modal-close/field-hint, white)
text3 on bg (section-title)                                              2.60  FAIL            FAIL
text3 on surface2 (card-tag)                                             2.48  FAIL            FAIL
teal-dark #0F6E56 on teal-light #E1F5EE (banner/tag.active/               5.46  PASS            PASS
   badge-done/tip box/card-pin)
teal #1D9E75 on teal-light #E1F5EE (banner-link)                         2.98  FAIL            FAIL
white on teal #1D9E75 (write-btn/btn-submit)                             3.39  FAIL            PASS
amber-dark #854F0B on amber-light #FAEEDA (warn/badge-pending)           5.87  PASS            PASS
white on dark #1a1917 (toast/inapp-banner)                              17.57  PASS            PASS
text2 on surface2 (auth-btn/info-box/post-action-btn)                    4.78  PASS            PASS
teal on surface2 (auth-btn:hover/post-action-btn:hover/upload-btn:hover) 2.94  FAIL            FAIL
teal on white surface (back-btn:hover)                                   3.39  FAIL            PASS
danger #E64A19 on surface2 (post-action-btn.danger:hover)                3.40  FAIL            PASS
```

---

## Critical

**1. Entire primary navigation and content grid is unreachable by keyboard.**
`index.html:617,619,630-663,663` — all sidebar nav items, the logo icon, and the site name are plain `<div onclick="navigate(...)">` with no `tabindex`, `role`, or key handler. `index.html:896-909` (`renderCard`) — homepage cards are built with `document.createElement('div')` + `addEventListener('click', …)`, again no `tabindex`/`role`. `index.html:144` — dynamically-rendered `post-card` divs, same pattern. Plain `<div>`s are not in the native Tab order and don't respond to Enter/Space, so a keyboard-only or switch-access user cannot open a single guide, calculator, or forum post.
Fix:
```html
<div class="nav-item" role="button" tabindex="0" data-page="home"
     onclick="navigate('home')"
     onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();navigate('home')}">
```
(Better: change these to real `<button>` elements — free keyboard/Enter/Space support, no extra JS.)

**2. No heading elements anywhere in the document.**
Confirmed via grep — zero matches for `<h1>`–`<h6>` in all 1040 lines. `site-name` (line 619), `guide-title`/`#guideTitle` (line 721), `modal-title`/`#postModalTitle` (line 744), `section-title` (lines 692-712) are all plain `<div>`s. Screen-reader users navigating by heading (the single most common SR navigation technique) find nothing at all — not even one `<h1>` for the site.
Fix: give the site an `<h1>` (visually-hideable) and promote `guide-title`/`modal-title`/`section-title` to `<h1>/<h2>/<h3>` as appropriate.

**3. Modals have no dialog semantics, no focus trap, no Escape, no focus return.**
`index.html:741-753` (postModal) and `756-798` (writeModal): opened via `classList.add('show')` (lines 189, 204, 245) and closed via the `✕` button (745, 760), `취소` (794), or a click-outside handler (995-1001). Nowhere in the script is there an `Escape`/`keydown` listener (confirmed — zero matches). Focus is never moved into the modal on open, never trapped (the underlying `.app` content at line 613 keeps its `tabindex`-free-but-still-native-focusable buttons reachable behind the translucent overlay), and never returned to the button/card that triggered the modal on close.
Fix:
```html
<div class="modal-overlay" id="postModal" role="dialog" aria-modal="true" aria-labelledby="postModalTitle">
```
```js
function openModal(id, triggerEl) {
  lastTrigger = triggerEl;
  document.getElementById(id).classList.add('show');
  document.getElementById(id).querySelector('.modal').focus();
  document.addEventListener('keydown', escHandler);
}
function closeModal(id) {
  document.getElementById(id).classList.remove('show');
  document.removeEventListener('keydown', escHandler);
  lastTrigger?.focus();
}
function escHandler(e){ if (e.key === 'Escape') closeModal(currentModalId); }
```

---

## High

**4. `--text3` (#9b998f) fails contrast everywhere it's used.** Used at: `.site-sub` (420), `.nav-group-label` (427), `.section-title` (465), `.card-tag` (478), `.empty-msg`/`.empty-board` (479, 493), `.post-card-meta` (492), `.modal-close` (501), `.field-hint` (540), `.search-input::placeholder` (457). Ratios range 2.48:1–2.86:1, i.e. below even the 3:1 large-text/UI floor, not just the 4.5:1 normal-text floor.
Fix: `--text3: #767468;` gets ~4.6:1 on white and ~4.2:1 on `--bg` — pick a value and re-verify per background.

**5. Primary CTA buttons fail contrast.** `.write-btn` (485, "글 작성"/"건의하기") and `.btn-submit` (548, "게시하기") are white text on `--teal` (#1D9E75) at 13–14px/500-weight — 3.39:1, below AA normal-text 4.5:1 (13–14px doesn't qualify as "large text" even at weight 500).
Fix: darken to `#137A59` (≈4.6:1) or bump size/weight to genuinely qualify as large text (≥18.66px bold).

**6. Icon-only buttons have no accessible name.** `.modal-close` `✕` (745, 760) and `.hamburger` `☰` (608) are rendered as raw glyphs with zero `aria-label`. A screen reader announces "button" with no purpose, or nothing at all depending on the AT.
Fix: `<button class="hamburger" id="menuBtn" aria-label="메뉴 열기">☰</button>`, `<button class="modal-close" aria-label="닫기" onclick="closePostModal()">✕</button>`.

**7. Form `<label>` elements are never programmatically associated with their inputs.** `index.html:767,771,776,780,788` — `<label>닉네임</label>`, `<label>비밀번호 …</label>`, `<label>제목</label>`, `<label>이미지 업로드</label>`, `<label>본문</label>` all sit as siblings before their respective `<input id="writeNickname">` (768), `<input id="writePassword">` (772), `<input id="writeTitleInput">` (777), `<input id="imageUpload">` (782), and the Quill container `<div id="quillEditor">` (789) — none use `for=`. This is worse than the existing report's generic example: it's present on every single field of the only form in the file, and the Quill editor field has *no* accessible name mechanism at all (Quill doesn't accept `aria-labelledby` out of the box without extra wiring).
Fix: `<label for="writeNickname">닉네임</label>`, etc.; for Quill, add `aria-label="본문"` to the toolbar-adjacent container or use `aria-labelledby` pointing at the visual label's `id`.

**8. Toast and validation messages are invisible to screen readers.** `#toast` (807) has no `role="status"`/`aria-live`. All feedback — `'제목을 입력해주세요.'`, `'비밀번호가 틀렸어요.'`, `'게시 완료!'` (lines 282-285, 301, 304, 310, etc.) — is shown only visually for 2.5s (`showToast`, 969-975) and never announced.
Fix: `<div class="toast" id="toast" role="status" aria-live="polite" aria-atomic="true"></div>`.

**9. SPA navigation never updates `document.title` and gives no live-region announcement.** `navigate()`/`showPage()` (863-892) update `mobileTitle` text and DOM visibility but never touch `document.title`, and there is no `aria-live` region announcing "이제 [페이지] 보고 있습니다." A screen-reader user clicking a nav item gets no signal a "page" changed.
Fix: set `document.title = `벽돌주식회사 - ${info.title}`` inside `showPage()`, and/or add a visually-hidden `aria-live="polite"` region updated on route change.

---

## Medium

**10. Touch targets are systemically under 40×40px — contradicts the existing report's "36×36px 이상" claim.** Computed from actual CSS box models (padding + font-size × line-height 1.6 inherited from `body`, line 410):

| Element | CSS (line) | Computed size |
|---|---|---|
| `.hamburger` | 588 | ~28px wide × ~40px tall |
| `.modal-close` | 501 (explicit `line-height:1`) | ~26×26px |
| `.tag` | 460 | ~27px tall |
| `.back-btn` | 442 | ~29px tall |
| `.auth-btn` | 423 | ~31px tall |
| `.admin-done-btn` | 567 | ~29px tall |
| `.post-action-btn` | 524 | ~31px tall |
| `.upload-btn` | 544 | ~33px tall |
| `.write-btn` | 485 | ~37px tall |
| `.nav-item` (whole sidebar row) | 428 | ~35px tall |

None reach the 40×40px minimum the task asked to check against; the report's "36×36px 이상" is optimistic even by its own bar.
Fix: bump vertical padding by 3–5px on the compact buttons (`.modal-close`, `.tag`, `.back-btn`, `.admin-done-btn`) and give `.hamburger` an explicit `min-width:44px;min-height:44px`.

**11. Hover-only teal text fails contrast.** `.auth-btn:hover` (424), `.back-btn:hover` (443), `.post-action-btn:hover` (525), `.upload-btn:hover` (545) all switch to `color:var(--teal)` on `--surface2`/`--surface` backgrounds → 2.94–3.39:1. `.banner-link` (452) is teal-on-teal-light at all times (not just hover) → 2.98:1, and it's a prominent top-of-page CTA.
Fix: use `#137A59` for hover/link text instead of raw `--teal` on light backgrounds.

**12. Continuous animation with no reduced-motion opt-out.** `@keyframes pulse` (450, applied to `.banner-dot` 449) and `@keyframes sparkle` (557-560, applied to `.admin-badge` 552-556) run `infinite` with no `@media (prefers-reduced-motion: reduce)` block anywhere in the stylesheet (confirmed — no such rule exists).
Fix:
```css
@media (prefers-reduced-motion: reduce) {
  .banner-dot, .admin-badge { animation: none; }
}
```

**13. Tag filter buttons expose no toggle state to AT.** `.tag` buttons (684-688) toggle a visual `.active` class via JS (944-946) but never set `aria-pressed`.
Fix: `<button class="tag active" data-tag="all" aria-pressed="true">전체</button>`, toggled alongside the class in the click handler.

**14. Search input has no real label, only a placeholder.** `index.html:681` `<input class="search-input" placeholder="이름, 설명, 태그로 검색...">` — no `<label>`, `aria-label`, or `aria-labelledby`; placeholder text vanishes once typing starts and isn't a reliable accessible name across all AT/browser combinations.
Fix: `<input class="search-input" aria-label="이름, 설명, 태그로 검색" placeholder="…">`.

**15. Uploaded post images get no alt text.** `window.uploadImage` (368-394) inserts images via `window._quill.insertEmbed(idx, 'image', url)` (383) with no alt-text prompt/step. Every image a user (including admins writing guides) inserts into a post ends up with an empty/missing `alt`, so all guide screenshots are invisible to screen-reader readers of the community board.
Fix: after `insertEmbed`, prompt for and set `alt` on the inserted `<img>` (Quill exposes the inserted DOM node via `quill.root.querySelector('img[src="'+url+'"]')`) or add a lightweight "이미지 설명" text field per upload.

---

## Low

**16. No skip-to-content link.** Once nav items are made keyboard-focusable (finding #1), a keyboard user must tab through the ~20-item sidebar every single time before reaching `<main>`.
Fix: `<a href="#view-home" class="skip-link">본문으로 바로가기</a>` as the first body child, visually hidden until focused.

**17. Seven near-identical stage-guide labels** ("신1 ~ 신4", "신4 ~ 신7", "신7 ~ 신11", "신11 ~ 신15" — lines 637-640) sit back-to-back in the sidebar with only a hyphenated number distinguishing them; minor misclick risk for first-time mobile players, especially combined with the small ~35px row height (#10).

**18. Calculator/tool pages have no cross-navigation** (confirmed, matches existing report §8): `IFRAME_PAGES` (839-846) load into `#view-iframe`, whose only navigation control is `← 홈으로` (line 731) — switching from one calculator to another always detours through the home grid.

---

## Corrections to `ACCESSIBILITY_REPORT.md` (claims about the files touched by index.html)

1. **Wrong number**: the report states `var(--text3): #9b998f → 배경과의 대비 3.8:1`. Actual computed ratio is **2.60:1 on `--bg`** and **2.86:1 on white surface** — meaningfully worse than claimed, and it fails even the 3:1 large-text/UI floor, not just the 4.5:1 text floor.
2. **Wrong/incomplete**: "모든 버튼(`onclick` 속성)이 `<button>` 태그 사용" (§5) — false. `index.html:617,619,630-663` are `<div onclick=...>`, not `<button>`. The report catches this partially in its very next bullet for `.card`, but its code sample (`<div class="card" onclick="navigate('guide-pre-god')">`) doesn't match the actual source — cards are built dynamically via `addEventListener` (line 906), not an inline `onclick` attribute — and it completely misses that the *entire 17-item sidebar nav* has the identical, more consequential problem.
3. **Overstated**: "터치 대상 크기 충분 (주요 버튼 36x36px 이상)" (§2.1) — not true for index.html; computed sizes for its actual buttons range ~26–37px (see finding #10 table above).
4. **Confirmed correct / already accurate**: `lang="ko"` present (line 2), viewport meta correctly configured with no zoom-blocking (line 5, no `user-scalable=no`/`maximum-scale`), `role="dialog"`/`aria-labelledby` genuinely absent from modals as claimed, no `aria-live` on results as claimed, and the "계산기 간 전환이 어려움" navigation-structure critique (§8) is accurate and reproducible in this file's `IFRAME_PAGES` routing.