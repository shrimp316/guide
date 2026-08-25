# Deep Accessibility + Usability Audit — Calculator Pages

Read all three files in full (`ascension.html` 637 lines, `dimension-ev.html` 288 lines, `forge.html` 539 lines) plus `ACCESSIBILITY_REPORT.md`. Contrast ratios below are computed with the actual WCAG relative-luminance formula (not estimated) — script and output captured during the audit. All three files were also grepped for `tabindex|role=|aria-` — **zero results in all three files**, confirming there is not a single ARIA attribute, role, or tabindex anywhere in this calculator suite.

---

## calc/ascension.html

| Sev | Location | Problem | Fix |
|---|---|---|---|
| **Critical** | `ascension.html:455` + CSS `:51-63` | `goHome()` is defined but **never called anywhere in the markup**; `.home-btn` CSS class is defined but unused in the body. There is no `<a>`, no button calling `goHome()` — the page is a dead end reachable only by browser Back. | Add `<button class="home-btn" onclick="goHome()" aria-label="홈으로">🏠</button>` in `.topbar` (near line 44-50). |
| **Critical** | `ascension.html:372-373, 474-485` | Stage selector (10 options, the primary calc input) is built as `<div class="stage-chip" onclick="setStage(i)">` — no `tabindex`, no `role="button"`, no keydown handler. **Completely unreachable by keyboard.** | `chip.setAttribute('role','button'); chip.tabIndex=0; chip.addEventListener('keydown', e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setStage(i);}})` or simply render `<button class="stage-chip">`. |
| **Critical** | `ascension.html:381,541,554-628` | Clearing `#attempts` (no `required`, no runtime guard) → `parseInt("")=NaN` → `calculate()` has zero validation → UI renders literal **`NaN분 NaN초`**, `NaN`-based table rows. Same for typed negative/zero attempts (min="1" doesn't block typed input) — silently computes a misleading result with no error message. | Add `if (!attempts || attempts <= 0) { showError('투입 횟수를 올바르게 입력하세요'); return; }` at top of `calculate()`. |
| **High** | `ascension.html:71-75,270-274,191` | `--text-muted: #9ca3af` on white/`--bg` = **2.54:1 / 2.33:1** — fails even AA-large (3:1). Used for `.page-subtitle`, every `.result-cell-label`, and input placeholders. | `--text-muted: #6b7280;` (already used elsewhere, → 4.83:1) or darker. |
| **High** | `ascension.html:282-283` | Headline result numbers: `.result-cell-value.gold` `#f59e0b` on white = **2.15:1**; `.result-cell-value.green` `#10b981` on white = **2.54:1**. Both badly fail AA — these are the numbers users read the calculator *for*. | `--gold: #b45309;` (used in header, 4.84:1) / `--green: #047857;` (5.21:1) for text-role usage. |
| **High** | `ascension.html:371,380,388,393,398` | Every field label is `<div class="form-label">…</div>`, sibling to the input, never `<label for>`. | `<label for="attempts" class="form-label">투입 횟수</label>` etc. |
| **High** | `ascension.html:420,604` | `#result-area` innerHTML is replaced silently in `calculate()` (line 604) with no `aria-live`. | `<div id="result-area" aria-live="polite" aria-atomic="true"></div>` |
| **Medium** | `ascension.html:220-222,307` | `.calc-btn` white-on-`--accent` and `.stage-chip.active` white-on-`--accent` = **3.80:1**. Text is 14px/12px, below the 18.66px bold threshold for "large text," so 4.5:1 is required — fails. | Darken accent to `#3563d4` (`--accent-dark`, already defined) for these text/bg pairs. |
| **Medium** | `ascension.html:295-303` | `.stage-chip` (padding 4px 10px, font-size 12px) ≈ **22px tall** — the primary interaction control, far below a 40px touch target. | `padding: 10px 14px; font-size: 13px;` (→ ~38-40px). |
| **Medium** | `ascension.html:131-143,343` | `.type-btn` ≈ 33px tall, `.time-select` ≈ 35px tall — both under 40px. | Increase vertical padding to ≥12px. |
| **Low** | `ascension.html:16,96` | `--border: #e8eaed` on white = **1.21:1** — card/input borders are essentially invisible (fails non-text UI 3:1 requirement). | Darken border to `#c9ccd3` or similar. |
| **Low** | `ascension.html:255-257` | `.result-section-header.blue` accent text on accent-light = 3.40:1 (11px bold, not large text) — fails 4.5. | Use `--accent-dark` for header text color. |

---

## calc/dimension-ev.html

| Sev | Location | Problem | Fix |
|---|---|---|---|
| **Critical** | whole file (confirmed via grep: no `<a`, `href=`, `<h1`, `<header`, `<nav`, `aria-`, `role=`) | This page has **zero navigation of any kind** — no home button, no back link, and no visible `<h1>`/heading at all (only a `<title>` tag). It is a fully isolated dead-end page, worse than what the original report described ("3 clicks through home") — here there are **0 in-page paths anywhere**. | Add a header with `<h1>` + a home link/button, matching the pattern the other two calculators at least attempt. |
| **Critical** | `dimension-ev.html:124-125, 137-138, 141-142` | All three fields use real `<label>` elements — **but none has `for=`, and none wraps its control** (they're flex siblings in `.form-item`). This looks correct in source but has **zero programmatic association**, arguably a worse trap than the div-label pattern flagged elsewhere since it looks fixed at a glance. | `<label for="field">필드 선택</label>` / `<label for="remaining">…</label>` / `<label for="cost">…</label>`. |
| **High** | `dimension-ev.html:138,196,200-208,217` | The validation guard `if (remaining <= 0 \|\| remaining > total)` (line 200) does **not** catch `NaN` (comparisons with `NaN` are always `false`). Clearing `#remaining` and clicking 계산하기 bypasses the guard entirely, and `expectedPerSlot = total/remaining` renders literally **`NaN회`** in the result box (line 217), plus a garbage flat line in the probability chart. | Add explicit `if (isNaN(remaining) || isNaN(cost)) { ...error...; return; }`. |
| **High** | `dimension-ev.html:126-127` | `<option value="81">알파 (81칸)</option>` and `<option value="81">베타 (81칸)</option>` share the **same `value="81"`** — selecting 베타 is functionally identical to 알파, almost certainly a copy-paste bug (bonus correctness finding, not pure a11y but affects usability of the "필드 선택" control). | Give 베타 its correct distinct cell count. |
| **Medium** | `dimension-ev.html:148,200-204` | Genuinely good: this file is the **only one of the three with a real user-facing validation message** ("⚠️ 올바른 남은 칸 수를 입력하세요.") — worth crediting. However `#result` has no `aria-live`/`role="alert"`, so screen reader users never hear either the normal result or this error. | `<div class="result" id="result" role="status" aria-live="polite" style="display:none"></div>` |
| **Medium** | `dimension-ev.html:152,156,160,164` | Four Chart.js canvases with zero text alternative — for a tool centered on 4 visualizations, screen reader users get nothing. | Add `aria-label` summarizing each chart, or a visually-hidden data table fallback. |
| **Low** | `dimension-ev.html:47-58` | Form inputs/selects ≈ 34.8px tall (padding 9px + 14px font) — under 40px. | `padding: 11px 12px;` |
| **Low** | `dimension-ev.html:138,142` | No `max` on `#cost`, no `inputmode="numeric"` on any of the three numeric fields. | Add `inputmode="numeric"` and reasonable `max`. |

---

## calc/forge.html

### Confirming/refuting ACCESSIBILITY_REPORT.md claims specific to this file

- **REFUTED** — report claims `--text-dim: #7a7f99` is **2.2:1**. Actual computed values: **4.78:1** on `--bg`, **4.26:1** on `--surface` (the real pairing for `.tab-btn`, line 66), **3.79:1** on `--surface2`. None are close to 2.2:1; the report's number is wrong. A real but much milder issue does exist — 4.26:1 and 3.79:1 both genuinely miss 4.5:1 for normal-size text (`.tab-btn` is 13px, not "large text").
- **REFUTED (misattributed)** — report cites `#007bff` link color at 2.1:1 "for forge.html" — `#007bff` does not appear anywhere in `forge.html` (grep confirms 0 matches). That number belongs to a different file (`payment.html`) and was miscategorized.
- **CONFIRMED** — missing label/for association: `select#item` (line 341, label is a sibling `<p class="section-label">` at line 339, not `<label>`), materials-grid inputs (line 452, labeled only by sibling `div.mat-name` at line 450), and `#count` (line 364, no associated label at all).
- **CONFIRMED** — tabs are plain buttons: `.tab-btn` (lines 332-333) has no `role="tablist"/"tab"`, no `aria-selected`; `.tab-panel` (lines 337, 384) has no `role="tabpanel"`; `switchTab()` (lines 526-532) has no arrow-key handling.
- **PARTIALLY CONFIRMED** — small button text: `.tab-btn` is 13px (line 61), but computed height (~39.6px from padding 12px) is close to acceptable; the real problem at that size is the 4.26:1 contrast above, not the touch target.

### New issues not in the original report

| Sev | Location | Problem | Fix |
|---|---|---|---|
| **Critical** | `forge.html:311-326` (CSS only, never used in `<body>`) | `.home-btn` CSS class defined but **never appears in the markup** — same dead-navigation bug as ascension.html. No `<a>` tag exists anywhere in this file (grep confirms). Zero in-page way home. | Add `<a class="home-btn" href="https://sites.google.com/view/brickinc/%ED%99%88" aria-label="홈으로">🏠</a>` inside `<header>`. |
| **High** | `forge.html:456-459` (×13, one per material) | `<label class="toggle">` wraps only the invisible checkbox + `.toggle-slider`; the visible text "0 처리" is a **sibling `<span class="zero-label">`** (line 155) outside the label. Every one of the 13 "0 처리" toggles has **no accessible name** — a screen reader announces only "checkbox, not checked." | `<input type="checkbox" class="zero-toggle" aria-label="${name} 0으로 처리" data-target="user_${id}" onchange="handleZero(this)">` |
| **High** | `forge.html:139-142` | `.mat-card input:disabled { color: var(--text-dim) }` on `--surface2` = **3.79:1** — fails AA for the (still meaningful) disabled-state value shown to sighted low-vision users. | Use a less-dim disabled color, e.g. `#9199b3` (~4.7:1). |
| **Medium** | `forge.html:17,55,280` | `--border: #2e3248` vs `--surface`/`--bg` = **1.33:1 / 1.50:1** — card, tab, and input borders fail the 3:1 non-text-contrast requirement, essentially invisible. | Lighten to `#454a68` or similar. |
| **Medium** | `forge.html:371-372,377` | `#resultValue`/`#resultEmpty` (toggled via `style.display` in `calculateTotal()`, lines 495-522) and `#recipeBody` update silently with no `aria-live`. | `<div class="result-card" id="resultCard" aria-live="polite">` |
| **Medium** | `forge.html:363,365` | Count stepper buttons use bare glyphs `−` / `＋` with no `aria-label` — ambiguous to screen readers. | `<button class="count-btn" onclick="changeCount(-1)" aria-label="개수 감소">−</button>` |
| **Medium** | `forge.html:158-182,163` | Toggle switch: the actual `<input type="checkbox">` is set to `width:0; height:0; opacity:0` (line 163) — any browser default focus ring lands on a **zero-size element** and is imperceptible; no `:focus-visible` rule compensates (confirmed via grep — only text inputs/select have `:focus` rules, lines 136, 219, 243). | `.toggle input:focus-visible + .toggle-slider { outline: 2px solid var(--accent); outline-offset: 2px; }` |
| **Low** | `forge.html:478,507-517` | `getPrice()` reads `parseFloat(el.value)` with **no clamp/validation** — a user can type a negative material price and get a silently negative/nonsensical "총 제련 비용," unlike `#count` which is clamped via `Math.max(1,...)` (line 490). | Clamp/validate in `getPrice()`: `return Math.max(0, val)`. |
| **Low** | `forge.html:158-162,316-317` | `.toggle` is 34×18px, `.home-btn` is 36×36px — both under the ~40×40 mobile target guidance; `.toggle`'s 18px height is also under WCAG 2.5.8's 24px minimum. | Increase toggle to at least 44×24px (WCAG minimum) or 48×28px for comfortable mobile tap. |
| **Low** | `forge.html:452` | Default material prices are shown only via `placeholder="${defVal}"` (disappears on focus, not a real value, not linked via `aria-describedby` to the separate `.mat-def` "기본: X" div at line 453). | Add `aria-describedby="def_${id}"` on the input pointing to the `.mat-def` element's id. |

---

## Summary: corrections to ACCESSIBILITY_REPORT.md

1. **Wrong number**: forge.html `--text-dim` contrast is not 2.2:1 — actual measured values are 3.79–4.78:1 depending on background (still a real, milder AA miss on 2 of 3 backgrounds).
2. **Miscategorized citation**: the `#007bff` "2.1:1 다크 배경" example does not exist in forge.html at all; that CSS value isn't present in the file.
3. **Understated navigation problem**: the report frames cross-calculator navigation as merely "어려움" (3 clicks via home) — in reality, **ascension.html and forge.html have zero working home-navigation elements** (dead CSS classes, unused JS functions) and **dimension-ev.html has no navigation or heading elements whatsoever**. This is a dead end, not a friction point.
4. Everything else touched by the report for these files (missing `label for`, missing tab ARIA roles, small button text as a contributing factor) is directionally correct, just shallower than the line-level detail above.