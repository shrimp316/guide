# Accessibility Audit: `tool/tree/tree.html` ("진리의 나무 — 최적 경로 탐색")

## What this tool is
A 17×17 (289-cell) skill-tree / build-planner. Grid nodes are rendered as **DOM `<div class="cell">` elements** (not canvas-drawn) laid out via CSS Grid, with a transparent `<canvas id="path-canvas">` overlaid only to draw connector lines between cells. Node state (activated/reachable/optimal/epic) is communicated via CSS classes (`activated`, `reachable`, `optimal`, `epic-node`, `highlighted`). A left side panel shows point totals, an auto-search optimizer (goal presets → BFS/greedy path search), a legend, and an Import/Export box that (de)serializes build state through an embedded Brotli-WASM decoder (`tree.html:1575`, a single 1.78MB base64 string — this one line accounts for ~91% of the file's 1.95MB size). 58 category icon images live externally in `images/` (648KB total, not inlined).

## Big picture answer
**This is a mouse/touch-only tool.** The 289 interactive grid nodes are plain `<div>`s with only `click` and `mouseenter` listeners (`tree.html:1066-1067`) — no `tabindex`, no keyboard handler, no `role`, no `aria-*` attribute anywhere in the entire file (verified: zero `role=`/`aria-` matches file-wide). A keyboard-only user cannot focus, inspect, or toggle a single node. A screen reader user gets no indication these 289 elements are interactive controls at all — they're just unlabeled `<div>`s with a background-image/emoji. The surrounding chrome (buttons, inputs, tabs) *is* built from real `<button>`/`<input>` elements and is keyboard-operable, so the app's "shell" works, but its actual core mechanic — placing points on the tree — does not.

---

## Findings

### Critical

**1. Grid nodes are not keyboard operable — core feature is mouse/touch-only.**
`tree.html:1042-1067`: cells are `document.createElement('div')` with no `tabindex`, and `onClick(r,c)`/`onHover(r,c)` are bound only via `click`/`mouseenter` (`tree.html:1066-1067`, handler body at `1152-1163`). No `keydown` handler exists for the grid at all (grep for `keydown` across the file only matches the unrelated points-input Enter-key handler at `1525`). A keyboard user cannot reach or activate any of the 289 nodes — the entire build-planning mechanic is unusable without a pointer.
*Fix*: make cells real controls — either `<button>` elements or `<div role="button" tabindex="0">` with `keydown` handling for Enter/Space, plus roving-tabindex or arrow-key grid navigation (this is exactly the `role="grid"`/`gridcell` or button-grid pattern).

**2. Grid nodes have no accessible name — invisible to screen readers.**
Cells carry no `aria-label`, `title`, or visible text; the only text-bearing content is the child `<img alt=eff>` (`tree.html:1052`, where `eff` is the raw effect string) or, if the image fails to load, an emoji glyph (`mkEmoji`, `1071-1076`). Even where the `alt` exists, the cell `<div>` itself has no role, so assistive tech has no reason to expose it as an interactive element in the first place — a screen reader user tabbing/browsing the page would encounter unlabeled decorative-looking images, not "node: +12% gold production, activate".
*Fix*: put `aria-label` (position + effect + state: activated/reachable/locked) directly on the cell element once it has a role, and keep it in sync in `refresh()`/`onClick`/`onHover`.

**3. Node info panel updates only on `mouseenter`, with no non-pointer equivalent.**
`onHover(r,c)` (`tree.html:1361`) populates `#node-name`/`#node-eff` and is wired only via `mouseenter` (`1067`). There is no `focus` listener, so even if a cell were made focusable, the info panel wouldn't update on keyboard focus without additional wiring. Currently this means the *only* way to learn what a node does is to physically hover a mouse over a 23–52px square.

### High

**4. `--text-dim` (#3d6644) fails WCAG AA contrast everywhere it's used.**
Computed against every background it appears on:
- on `--bg` #081510: **2.83:1**
- on `--panel-bg` #0a1e10: **2.64:1**
- on `--grid-bg` #0b1c12: **2.68:1**

All fail AA for both normal (4.5:1) and large text (3:1). This variable is used for real, non-decorative content: the header subtitle (`tree.html:54`), `.point-display .label` ("남은"/"총", `67`), `.stat-row` labels ("총 포인트"/"사용"/"남은"/"활성 노드", `561-564`, css `244`), `.priority-list`/`.pri-label`, `.node-pos` placeholder ("마우스를 올려보세요", `570`), goal-btn unselected state color (`256`), the Import/Export helper text color (`598`), and mode-tab inactive color (`415`). This is a systemic, repeated failure, not a one-off.
*Fix*: raise `--text-dim` lightness — something around `#6a9a72` on the darkest background would clear 4.5:1; verify per-background.

**5. Touch targets are far under minimum size at mobile breakpoints.**
`.cell-inner` (the actual visible/clickable icon square) shrinks via media queries:
- ≤900px: 30×30px (`tree.html:387`)
- ≤480px: 23×23px (`tree.html:404`)

23×23px is below even the WCAG 2.2 §2.5.8 minimum (24×24 CSS px) and well under the 44×44px Apple/Material recommendation, on a *mobile game guidebook* audience most likely to be on phones. Adjacent cells are packed edge-to-edge (`grid-template-columns: repeat(17, var(--cell-size))`, `114`), so mis-taps activating the wrong node are likely.
*Fix*: keep the visual icon small if needed for density, but make the actual hit target (the parent `.cell`, currently sized to `--cell-size`, i.e. 30/38px) the full grid-size square (it already is, per `124-128` — so the *effective* click target is 30px/38px, still under 44px at both mobile tiers, and 23px visual icon inside a 30px hit-box is a confusing visual/touch mismatch since the visible icon looks smaller than what's tappable).

**6. Modal dialog lacks any accessibility semantics or keyboard support.**
The guide modal (`tree.html:1719-1725`) has no `role="dialog"`, no `aria-modal="true"`, no `aria-labelledby`, no focus trap, and no `Escape`-to-close handler (only click on the overlay, `1811`, or the close button). Opening it doesn't move focus into the dialog, and closing it doesn't return focus to the trigger button. Screen reader users won't know a modal opened; keyboard users have no way to close it without knowing to Tab to the (unlabeled beyond emoji) ✕ button.
*Fix*: add dialog semantics, trap focus while open, close on Escape, restore focus to `.guide-float-btn` on close.

### Medium

**7. State (activated/reachable/optimal/epic) is conveyed by color/glow alone in several cases.**
`.cell.activated`, `.cell.reachable`, `.cell.optimal` (`tree.html:171-199`) differ only by border color + box-shadow glow (cyan/amber/blue) — no icon, pattern, or text difference between "reachable-but-not-activated" and "activated." The epic-node `★` badge (`187-193`) is a good example of *not* relying on color alone, but the primary activation states don't follow that pattern, which affects both colorblind users and (per finding #1/#2) is moot for non-sighted users anyway since it's not exposed as text either way.
*Fix*: add a persistent non-color cue for activated state (e.g. a checkmark glyph or filled-icon opacity is already used at `169`/`176`/`184` for opacity — could pair with a small badge glyph for "activated" specifically).

**8. 1.78MB base64-encoded WASM blob inlined directly in the HTML (`tree.html:1575`).**
This single line is ~91% of the file's total size. Base64 inflates binary size by ~33%, and because it's inline, the browser must fully download and parse the entire 1.9MB HTML document (blocking the initial DOM/CSSOM/script parse) before any interactivity — including the Import/Export feature that actually needs the WASM — is available. It also cannot be independently cached across page loads/updates the way an external `.wasm` file could (a normal `<script src>`/`fetch()`ed asset benefits from HTTP caching; embedding it in the HTML means the full multi-MB payload re-downloads on every edit to *any* part of the page, e.g. every "Update tree.html" commit visible in this repo's history). For a mobile-game guide audience likely on constrained mobile data/older devices, this is a real load-time and battery/CPU cost (base64→binary decode of ~1.8MB of text) that indirectly harms accessibility (WCAG 2.2.1/2.2.5-adjacent "enough time," and general low-end-device usability).
*Fix*: extract the WASM to `brotli.wasm`, load via `fetch()`/`WebAssembly.instantiateStreaming`, and only load it lazily when Import/Export is actually used (it doesn't appear needed for the core grid interaction at all — defer it).

### Low

**9. `title`-only accessible name on the guide button is fragile.**
`<button class="guide-float-btn" ... title="사용 가이드">📄</button>` (`tree.html:1716`) — since the button has visible text content (the emoji), most accessibility trees compute the accessible name from that text content, not the `title`. Depending on the screen reader/OS Unicode-name mapping, this could announce as something like "page facing up" rather than "사용 가이드" (user guide). `title` also doesn't show on touch devices at all.
*Fix*: add `aria-label="사용 가이드"` explicitly rather than relying on `title`/emoji-name fallback.

**10. Search has no non-visual feedback.**
`#search-input`'s `input` handler (`tree.html:1497-1503`) only toggles a `.highlighted` CSS class (yellow glow) on matching cells — no result count, no `aria-live` region announcing "N matches found," nothing a screen reader user could act on even if cells were otherwise made accessible.

### Things that are actually fine
- `lang="ko"` is set (`tree.html:2`), viewport meta is present and reasonable (`5`), and there's a real `<title>` (`6`).
- Text color palette (non-`text-dim` tokens) passes AA comfortably: `--text` 10.18:1, `--text-bright` 14.80:1, `--gold` 8.14:1, `--gold-light` 12.48:1, `--active-color` 13.04:1 against the main background.
- Category icon images (`m.src`) do carry `alt=eff` (`tree.html:1052`), and there's an `onerror` fallback to an emoji+text node (`1053`) rather than a broken-image icon.
- All *non-grid* controls (buttons, number/text inputs, tabs, goal buttons) are semantic `<button>`/`<input>` elements, so they're natively focusable and operable by keyboard — the shell chrome around the tree is fine, only the tree itself is not.
- Images are external files in `images/` (648KB across 58 files), not inlined — reasonable, though none use `loading="lazy"`, which would help since presumably not all 58 are visible at once (minor, not flagged above as its own item since it's dwarfed by finding #8).

---

## Bottom line
Treat this as **not accessible to keyboard-only or screen-reader users** for its primary function today. The chrome/controls are close to compliant already; the entire remediation effort should focus on making the 289 grid cells real, labeled, keyboard-operable controls (findings #1–#3), fixing the `--text-dim` contrast failure (#4), and enlarging mobile touch targets (#5). The WASM-inlining issue (#8) is a separate, load-performance concern worth fixing but architecturally simple (externalize + lazy-load).