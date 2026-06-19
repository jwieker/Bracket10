---
tags: [design, frontend, css, ejs, theming]
updated: 2026-04-20
---

# Bracket Application Design System

## Core Identity
A clean, modern interface for an NCAA basketball tournament bracket application. The design conveys excitement and competition using a vibrant orange brand color, with full light/dark theme support built on top of Bootstrap 5.

## 0. Theming Model

The entire UI is driven by CSS custom properties ("design tokens") defined in `public/tokens.css`. The theme is toggled by setting `data-theme="dark"` on the `<html>` element — a tiny inline script in `views/partials/header.ejs` reads `localStorage.theme` (falling back to the browser's `prefers-color-scheme: dark` preference) before first paint to avoid a flash of the wrong theme. A moon/sun toggle button in the navbar persists the choice.

- **Single source of truth**: to restyle the app, edit only `public/tokens.css`.
- **Light theme**: declared on `:root`.
- **Dark theme**: declared on `[data-theme="dark"]` and overrides the same variable names.
- **Flicker-free switcher**: the switcher buttons get their active styling from CSS selectors keyed on `data-theme` (`[data-theme="dark"] #theme-dark`, `html:not([data-theme="dark"]) #theme-light`), so the correct button paints lit before JavaScript runs. The initial paint only persists to `localStorage` on an explicit click, so visitors who never choose keep following their OS preference.
- Alert, badge, and surface pairs (bg + fg + border) are declared together so contrast stays balanced across themes.

### Bootstrap variable remap

Bootstrap 5.3 exposes its own CSS custom properties (`--bs-body-color`, `--bs-border-color`, `--bs-secondary-color`, etc.). We remap them to our tokens inside `:root` in `tokens.css` so built-in Bootstrap utilities (labels, `.text-secondary`, `.text-body`, `.card`, `.table-light`, modals, alerts) stay theme-aware automatically.

**CSS load order matters.** In `views/partials/header.ejs` Bootstrap's CDN is loaded **before** `tokens.css` / `style.css` / `bracket.css` so our cascade consistently wins at equal specificity.

```html
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/.../bootstrap.min.css">
<link href="/tokens.css">
<link href="/style.css">
<link href="/bracket.css">
```

### Theming — Quick Reference

- All colors, spacing, radius, shadows, and font stacks live in `public/tokens.css`. **Never hardcode colors** in a view or CSS file — always reference `var(--token-name)`.
- Theme is toggled via `data-theme="dark"` on `<html>`. An inline script in `views/partials/header.ejs` reads `localStorage.theme` (or the system `prefers-color-scheme` fallback) before first paint; the navbar sun/moon button persists the user's choice.
- Active states of the switcher buttons are styled in CSS using `[data-theme]` selectors to prevent render flicker on first paint.
- Bootstrap CDN **must** load before our custom stylesheets (it does in `header.ejs`). Our tokens remap Bootstrap's internal vars (`--bs-body-color`, `--bs-secondary-color`, `--bs-border-color`, etc.) so built-in utilities stay theme-aware.
- When changing any precached CSS, **bump `CACHE_NAME` in `public/service-worker.js`** (currently `bracket10-v17`) so clients fetch the new file.
- Typography utilities (`t-display`, `t-h1…t-h3`, `t-body`, `t-small`, `t-label`, `t-mono`) live in `style.css` and mirror `Design System.html`. Prefer these over ad-hoc `fs-*` + `fw-*` combinations.

## 1. Color Palette

All colors live as CSS custom properties in `public/tokens.css`. Light values are listed first, dark equivalents in parentheses.

### Surfaces
- `--bg-body`: `#edeff3` (dark: `#242830`)
- `--bg-card`: `#ffffff` (dark: `#323841`)
- `--bg-header`: `#ffffff` (dark: `#2c323b`)
- `--bg-soft`: `#f5f6f9` (dark: `#3b424c`)
- `--bg-softer`: `#eef0f4` (dark: `#464d58`)
- `--bg-hover`: `rgba(234, 123, 64, 0.06)` (dark: `#3e4550`)
- `--bg-overlay`: `rgba(237, 239, 243, 0.85)` (dark: `rgba(36, 40, 48, 0.96)`)
- `--border-color`: `#e2e5eb` (dark: `#4a5260`)
- `--border-strong`: `#cfd3dc` (dark: `#5a6270`)

### Page Background Gradient & Image Fallback

To ensure a highly premium, first-class aesthetic even when the background image (`teams.webp`) is missing or fails to load, the global background is implemented using a robust pure-CSS layer stack:

1. **Fallback Gradient**: The base `body` element is painted with a beautiful, theme-appropriate CSS gradient (`linear-gradient(135deg, var(--bg-soft) 0%, var(--bg-body) 50%, var(--bg-softer) 100%)` in light mode, and a rich charcoal-to-slate cosmic gradient `linear-gradient(135deg, #2b303c 0%, #242830 50%, #1a1d24 100%)` in dark mode).
2. **Pseudo-Element (`body::before`) Layering**: The `teams.webp` background image is loaded inside a fixed `body::before` pseudo-element with `z-index: -1` and `opacity: 0.15` (blending with the elegant fallback gradient).
3. **Missing Image Graceful Handling**: If `teams.webp` fails to load, the pseudo-element is transparent and only the premium background gradient is visible, ensuring a stunning first impression with no flat-gray fallback.
4. **Performance Boost**: Moving the fixed background image to a hardware-accelerated pseudo-element completely resolves mobile scroll performance lag (avoiding costly paint storms triggered by legacy `background-attachment: fixed`).

### Brand & semantic
- `--primary-color`: `#ea7b40` (dark: `#f79563`) — basketball orange; navbar, buttons, primary actions
- `--primary-dark`: `#d96a30` — hover state
- `--primary-soft`: `rgba(234, 123, 64, 0.12)` — focus rings / tints
- `--accent-color`: `#3b82f6` (dark: `#60a5fa`) — secondary actions, active states
- `--blue-link`: `#1a6bbf` (dark: `#7fb2e8`) — body-copy links inside tables
- `--success-color`: `#10b981` (dark: `#34d399`) — wins, correct picks
- `--danger-color`: `#ef4444` (dark: `#f87171`) — losses, eliminations
- `--warning-color`: `#f59e0b` (dark: `#fbbf24`) — warnings
- `--gold` / `--silver` / `--bronze` — podium tints

### Typography colors
- `--text-main`: `#111827` (dark: `#f3f4f6`) — primary text
- `--text-muted`: `#6b7280` (dark: `#c4ccd8`) — secondary copy, labels
- `--text-xmuted`: `#9ca3af` (dark: `#8b94a3`) — tertiary metadata
- `--text-light`: `#f9fafb` — reserved for text on dark/orange surfaces

### Alert / badge surface pairs

Each alert and badge ships with matching background + foreground + border tokens so both themes have balanced contrast without per-component overrides:

- `--alert-{info|success|warn|danger}-{bg|fg|border}`
- `--badge-{success|warn|danger|info}-{bg|fg}` plus `--badge-bg` / `--badge-fg` for neutral

### Bootstrap variable remap (excerpt)
```
--bs-body-color:      var(--text-main);
--bs-body-bg:         var(--bg-body);
--bs-secondary-color: var(--text-muted);
--bs-tertiary-color:  var(--text-xmuted);
--bs-border-color:    var(--border-color);
--bs-heading-color:   var(--text-main);
--bs-link-color:      var(--primary-color);
--bs-link-hover-color:var(--primary-dark);
```

## 2. Typography

- **Primary font**: `Inter` via system font stack
  `'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- **Mono font**: `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`

### Utility classes (defined in `style.css`, mirror `Design System.html`)

| Class        | Size / weight                     | Color              |
|--------------|-----------------------------------|--------------------|
| `.t-display` | 36px / 800, letter-spacing -0.025em | `--text-main`    |
| `.t-h1`      | 28px / 700                        | `--text-main`      |
| `.t-h2`      | 22px / 700                        | `--text-main`      |
| `.t-h3`      | 17px / 700                        | `--text-main`      |
| `.t-body`    | 14px / 400, line-height 1.5       | `--text-main`      |
| `.t-small`   | 13px / 400                        | `--text-muted`     |
| `.t-label`   | 10.5px / 700, uppercase, tracked  | `--text-muted`     |
| `.t-mono`    | 13px                              | `--text-main`      |

These are declared **after** the base `h1…h6 { color: var(--text-main) }` reset so they win cascade when applied to bare heading tags.

Table headers still use the legacy pattern: uppercase, `0.65rem`–`0.75rem`, `letter-spacing: 0.05em`, weight 600.

## 3. Spacing & Radius

```
--spacing-xs: 0.25rem   (4px)
--spacing-sm: 0.5rem    (8px)
--spacing-md: 1rem      (16px)
--spacing-lg: 1.5rem    (24px)
--spacing-xl: 2rem      (32px)

--radius-sm: 0.375rem
--radius-md: 0.5rem
--radius-lg: 1rem
```

## 4. Shadows

Light theme:
```
--shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05)
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)
```

Dark theme redefines the same variables with higher alphas so shadows remain visible on darker surfaces.

## 5. UI Components

### Navbar
- Background: `--primary-color` with Bootstrap `navbar-dark` (white text/icons).
- Brand: `font-weight: 800`, `letter-spacing: -0.025em`, `font-size: 1.4rem`.
- Theme toggle button (sun ↔ moon inline SVGs) sits next to the brand; persists to `localStorage.theme`.

### Buttons
- `.btn-primary` — solid `--primary-color`, weight 600, `--radius-md`, hover → `--primary-dark`.
- `.btn-success` / `.btn-danger` / `.btn-warning` / `.btn-info` / `.btn-secondary` are all tokenized with matching outline variants. Dark-mode outline buttons fill on hover with their token color.
- `.btn-google` — the "Sign in with Google" button used on the landing page (`views/partials/userSignIn.ejs`) and admin login (`views/adminLogin.ejs`). Pair it with Bootstrap's base `.btn` and give the SVG mark the `g-logo` class (auto-sizes 16/18/20px for `.btn-sm`/default/`.btn-lg`). **Intentional token exception:** this is the one component that hardcodes hex colors rather than using `var(--token-name)` — Google's brand guidelines require their exact light (`#ffffff` fill, `#1f1f1f` text, `#dadce0` border) and dark (`#131314` fill, `#e3e3e3` text, `#5f6368` border) surface treatments. The light/dark split is handled by a `[data-theme="dark"] .btn-google` override; focus rings still use `--primary-soft` to stay consistent with the rest of the app.

### Cards
- `.card`: `--bg-card`, `--border-color`, `--radius-lg`, `--shadow-sm`. Subtle hover via `transform 0.2s, box-shadow 0.2s`.
- `.card-header`: `--bg-soft`, `--text-muted`, bottom border `--border-color`.
- `.card-body` / `.card-footer`: inherit `--text-main`, transparent background over the card surface.
- Also remaps `--bs-card-*` so Bootstrap-styled cards follow the same tokens.

### Forms & Inputs
- `.form-control`, `.form-select`, `.form-check-input`: tokenized with focus ring `--primary-soft` and `--primary-color` border.
- **Chrome autofill fix**: `:-webkit-autofill` uses `-webkit-box-shadow: 0 0 0 1000px var(--bg-soft) inset` so dark-mode inputs don't flash yellow.

### Tables

Two table systems share a tokenized base:

**1. Main results / leaderboard table** (`public/style.css`):
- `.table-responsive` wrapper: `--bg-card`, `--radius-lg`, `--shadow-md`.
- `.table thead th`: `--bg-soft` with uppercase micro-type.
- Sticky first column (`position: sticky; left: 0; z-index: 10`) keeps the name column visible while scrolling horizontally.
- **Mobile (`max-width: 768px`)**: main table hidden, replaced by `.mobile-entry-card` cards.

**2. Card-style table** (`public/table-styles.css`):
- `.card-table-container` / `.custom-card-table` — softer visual weight, `--bg-soft` header.
- Zebra stripes: odd rows = `--bg-card`, even rows = `--bg-softer` (light) / `--bg-soft` (dark). In dark mode we set both stripes explicitly and zero out Bootstrap's `box-shadow` cell painter so stripes stay dark.
- `.details-row` expansion surface uses `--bg-softer` (light) / `--bg-soft` (dark).
- Collapsible rows (`.table-view-collapse`) hide columns at 1200 / 700 / 576px breakpoints.

**`.table-light` remap**: Bootstrap paints `<thead class="table-light">` via `--bs-table-bg`/`--bs-table-color` custom properties. We rebind those vars to our tokens so the light-header block stays readable on dark.

### Search Bar (Results Page)
Lives between `.card-table-header` and the table/card list on `results.ejs`, defined in `public/table-styles.css` as `.results-search-bar`. Filters both desktop rows (`#groupTable tbody tr[data-search]`) and mobile cards (`.mob-entry-card[data-search]`) through a single `filterResults()` call. Input displays a live "N of M entries" count.

### Mobile Card View (Results Page)
On `max-width: 768px`, `.results-table-wrapper` is hidden and `.mobile-card-list` renders instead. The two lists are **siblings** inside `.card-table-container` — never nest the card list inside the table wrapper or the media query will hide it too.

Structure:
```
.card-table-container
  .results-search-bar          ← always visible
  .results-table-wrapper       ← display:none on mobile
    .table-responsive
      table#groupTable
  .mobile-card-list            ← display:none on desktop (≥769px)
    .mob-entry-card × N
```

Each `.mob-entry-card` uses a single `.mob-card-visible-row` with three columns: rank badge, content (name/team + stat strip), and right-aligned points. Rank badges reuse the same 26×26 circular style as the desktop `.tbl-rank-badge`.

### Alerts & Badges
Use the `--alert-*` / `--badge-*` surface pairs so both themes stay readable without per-component overrides. Avoid Bootstrap's raw `alert-info`/`alert-danger` default colors — the remap at `style.css:.alert-*` redirects them to our tokens.

### Modals
`.modal-body` forces `--bg-card` background and `--text-main` text so modal contents match the surrounding theme.

## 6. Bracket Component

The bracket view (`views/partials/bracket.ejs`) uses a responsive flexbox layout with container queries for scaling. All colors come from tokens — it's dark-safe without any per-theme overrides.

- `.bracket-wrapper`: `container-type: inline-size` for container-query-based scaling.
- `.bracket-body`: flex container for the bracket halves.
- `.round`: tournament round columns with `justify-content: space-around`.
- `.team`:
  - `.picked-win` — success tint (`--success-color` / `--green-bg`)
  - `.picked-loss` — danger tint (`--danger-color`)
- `.region-label2`: region labels between halves.

## 7. CSS File Reference

| File                       | Purpose                                                            |
|----------------------------|--------------------------------------------------------------------|
| `public/tokens.css`        | **Single source of truth** for colors, spacing, radius, shadows, fonts, and Bootstrap variable remap. Declares `:root` (light) + `[data-theme="dark"]` overrides. |
| `public/style.css`         | Global resets, typography utilities (`t-*`), navbar, buttons, cards, forms, tables, modals, alerts, badges, PWA banner |
| `public/bracket.css`       | Bracket rendering for `views/partials/bracket.ejs`                 |
| `public/table-styles.css`  | `.card-table-container` / `.custom-card-table`, results search bar, mobile card list, scrollbar styling |
| `public/playground.css`    | `/playground` hypothetical-simulator page-specific styles           |

Bootstrap 5.3.3 is loaded via CDN **before** our stylesheets so our tokens and utilities consistently override Bootstrap's defaults.

## 8. PWA

- Install banner (`.fixed-bottom`) on mobile plus an iOS share-sheet instructions modal (`#iosPwaModal`).
- Service worker registered in `views/partials/header.ejs`.
- `public/service-worker.js` caches `tokens.css`, `style.css`, `bracket.css`, `playground.css`, and `table-styles.css` at install. **Bump `CACHE_NAME` (currently `bracket10-v17`) whenever you change any cached static asset** so clients fetch the new CSS.

## 9. Accessibility

- Use semantic elements: `<nav>`, `<main>`, `<section>`.
- All interactive elements meet AA contrast against their surface in **both** themes — verify new components in light and dark before shipping.
- External links carry `aria-label` with "(opens in a new tab)".
- Theme toggle button has `aria-label="Toggle dark mode"` and swaps sun ↔ moon SVG on click.

## 10. Adding a New Themed Component — Checklist

1. **Never hardcode colors.** Always use `var(--token-name)`. If no token fits, add one to `tokens.css` (both light and dark blocks).
2. **Prefer Bootstrap-aware styling.** If you're theming a Bootstrap component (card, table, modal, alert), remap its `--bs-*` custom properties inside the component's base class rather than fighting individual children with `!important`.
3. **Verify in both themes** by toggling the navbar sun/moon button. Watch for:
   - Unreadable text (low contrast — usually means a hardcoded `#xxx` slipped in)
   - Bright Bootstrap defaults leaking through (e.g. `table-light`, `bg-light`, `.alert-*` without token remap)
   - Input fills flashing yellow in Chrome (add `:-webkit-autofill` override if needed)
4. **Bump `CACHE_NAME`** in `public/service-worker.js` whenever you change `tokens.css`, `style.css`, or any other precached CSS file.
5. Reference `Design System.html` and `Design System Dark.html` (in this folder) for the canonical component gallery.

---

## 11. EJS Implementation Patterns

### Critical: Avoid EJS Expressions Inside CSS `style` Attributes

The VS Code CSS linter parses the content of `style="..."` attributes and throws false-positive errors on EJS `<%= ... %>` expressions (e.g. `style="color: <%= someColor %>;"`). These errors do **not** affect runtime rendering, but they are noisy and confusing.

**Pattern to follow: use `data-` attributes + JavaScript to apply dynamic styles.**

```html
<!-- ❌ Causes lint errors -->
<div style="border-color: <%= team.primaryColor ? '#' + team.primaryColor : '#ccc' %>">

<!-- ✅ Correct approach -->
<div class="team-logo-box" data-border-color="<%= team.primaryColor ? '#' + team.primaryColor : '#ccc' %>">
```

Then in the page's `DOMContentLoaded` handler (or a `show.bs.modal` handler for modal content):

```js
document.querySelectorAll('.team-logo-box[data-border-color]').forEach(el => {
    el.style.borderColor = el.dataset.borderColor;
});
```

This applies to **any** dynamic CSS value computed server-side (colors, opacities, etc.).

> **Note:** For binary states (e.g. win/loss color), prefer dedicated CSS classes (`.badge-wl-win`, `.badge-wl-loss`) rather than data attributes — it's cleaner and avoids the JS step entirely.

---

## 12. School Logo Box Component

Used in `fullGrid.ejs` column headers and `results.ejs` pick card rows.

**CSS class:** `.team-logo-box` (defined in the shared stylesheets; tokenized)

```css
.team-logo-box {
    width: 30px; height: 30px;     /* 32px in results.ejs pick cards */
    border-width: 2px; border-style: solid;
    border-color: var(--border-strong); /* fallback when no primaryColor */
    border-radius: var(--radius-sm);
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
    background: var(--bg-card);
    flex-shrink: 0;
}
```

**Data source:** `logoUrl` and `primaryColor` come from `schoolRecords` (denormalized at tournament setup). Both can be `null` before ESPN enrichment runs.

**Always provide fallbacks:**
- Border color: `team.primaryColor ? '#' + team.primaryColor : 'var(--border-strong)'` (set via JS/data-attr — team primary colors are dynamic and don't go through the token system)
- Logo: if `logoUrl` is null, show `(nameNick || name).substring(0, 2).toUpperCase()` as text inside the box

---

## 13. Full Grid Page (`fullGrid.ejs`)

### Header Row Design

The table uses a **single `<thead>` row** (not two). Each team column `<th>` contains a stacked flex column:

```
[seed badge] [region name]
[30×30 logo box]
[short name (nameNick)]
[pick count]
```

- Use `team.nameNick || team.name` for the display name (short nickname, not full university name)
- Left sticky label columns (Entry, Rank, Points, etc.) use class `grid-label-col` for `vertical-align: bottom`
- Team columns use `full-grid-sticky-1` (one sticky row now, previously two)

> **History:** The header was previously two separate `<tr>` rows (seed/region + labels/logos). These were merged into one row to eliminate vertical alignment jumping between rows of different heights.

---

## 14. Results Page (`results.ejs`) — Entry Picks Modal

When a user clicks an entry, a Bootstrap modal opens showing their picks.

### Pick Card List (`.picks-card-list`)

Replaces the old plain `<table>`. Each pick is a `.pick-card-row` flex row:

```
[colored left border]  [32×32 logo]  [seed] TeamName   [W][W][L]   pts
                                     region
```

**CSS classes involved:**
- `.pick-card-row` — the row container; gets `borderLeft`, `opacity` applied via JS on `show.bs.modal`
- `.pick-logo-box` — logo container; gets `borderColor` applied via JS on `show.bs.modal`
- `.pick-wl-chips` — fixed-width (152px), no-wrap, right-aligned chip container for W/L results
- `.badge-wl-win` / `.badge-wl-loss` — green/red badges for W/L results (static CSS, no JS needed)
- `.pick-pts` — points div; gets `color` applied via JS on `show.bs.modal`

**Dynamic color application (JS):**
Colors fire on `show.bs.modal`. The handler `applyPickCardColors(modalEl)` reads:
- `data-accent` → `borderLeft` on row, `color` on pts
- `data-elim` → `opacity: 0.55` on row, grey color on pts
- `data-border-color` → `borderColor` on logo box

### W/L Chip Alignment

The `.pick-wl-chips` container is **fixed width (152px)** with `flex-wrap: nowrap` and `justify-content: flex-end`. This ensures all rows align consistently regardless of how many rounds a team played — teams eliminated early right-align their single chip, teams with 6 rounds fill the width.

---

## 15. CSV Export (`getFullGridCSV` in `viewController.js`)

The endpoint replaced `exceljs` (22 MB) with a plain CSV response using RFC 4180 quoting. No external dependencies — cells containing commas, double-quotes, or newlines are wrapped in double-quotes with internal quotes escaped as `""`.

Cells beginning with `=`, `+`, `-`, `@`, TAB, or CR are prefixed with a single quote **before** quote-wrapping, so attacker-controlled entrant/team names can't smuggle spreadsheet formulas into the export (CSV/DDE injection — see `docs/architecture/security.md` § CSV Export Formula-Injection Defense).

The W/L row (`wlRow`) must have the same number of leading empty strings as fixed columns in the `headers` array. Currently **8 fixed columns** (Rank, Entry, Team, Points, Teams Remaining, Advanced, Best Rank, Max Score), so `wlRow` starts with 8 empty strings before the team game-status values.

```js
const headers = ["Rank", "Entry", "Team", "Points", "Teams Remaining", "Advanced", "Best Rank", "Max Score", ...teamHeaders];
const wlRow   = ["",     "",      "",     "",       "",                "",         "",          "",           ...teamStatuses];
//               ^ must match the number of fixed headers above ^
```

The file downloads as `fullgrid-<groupName>-<year>.csv` and opens natively in Excel and Google Sheets.

## Related Files

- `docs/architecture/security.md` — CSP rules that affect inline event handlers and `<script>` tags
