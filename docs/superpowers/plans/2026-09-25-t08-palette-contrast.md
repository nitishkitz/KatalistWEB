# Palette contrast measurement — 2026-09-25 (T08/D03)

Computed directly from `src/styles.css`'s OKLCH token values (converted OKLCH -> linear sRGB -> WCAG relative luminance -> contrast ratio; see `scripts/lib/color-contrast.mjs`), not inferred from a screenshot or from font size. Re-run with `node scripts/measure-palette-contrast.mjs`; the same pairs are asserted in `scripts/t08-palette-contrast.test.mjs`.

**Scope note:** this app's `.dark {}` block in `styles.css` currently duplicates every `:root` value verbatim (confirmed by direct comparison) — there is exactly one shipped palette today, so only `:root` is measured.

## Text pairs (WCAG AA normal text, >=4.5:1)

| Usage | Tokens | Ratio | Required | Verdict |
|---|---|---|---|---|
| Body text on the page background | `--foreground` / `--background` | 17.31:1 | 4.5:1 | PASS |
| Secondary/metadata text on the page background | `--muted-foreground` / `--background` | 4.85:1 | 4.5:1 | PASS |
| Card body text | `--card-foreground` / `--card` | 17.31:1 | 4.5:1 | PASS |
| Popover/menu body text | `--popover-foreground` / `--popover` | 17.31:1 | 4.5:1 | PASS |
| Primary button label | `--primary-foreground` / `--primary` | 5.28:1 | 4.5:1 | PASS |
| Secondary button label | `--secondary-foreground` / `--secondary` | 17.31:1 | 4.5:1 | PASS |
| Accent surface label | `--accent-foreground` / `--accent` | 17.31:1 | 4.5:1 | PASS |
| Destructive button label | `--destructive-foreground` / `--destructive` | 3.89:1 | 4.5:1 | FAIL |
| Sidebar body text | `--sidebar-foreground` / `--sidebar` | 17.31:1 | 4.5:1 | PASS |
| Sidebar active item label | `--sidebar-primary-foreground` / `--sidebar-primary` | 5.28:1 | 4.5:1 | PASS |
| Sidebar hover/accent item label | `--sidebar-accent-foreground` / `--sidebar-accent` | 17.31:1 | 4.5:1 | PASS |

## Status labels (bold/badge text, treated as large text, >=3:1)

| Usage | Tokens | Ratio | Required | Verdict |
|---|---|---|---|---|
| "Now" status label | `--status-now` / `--status-now-bg` | 4.74:1 | 3:1 | PASS |
| "Next" status label | `--status-next` / `--status-next-bg` | 4.74:1 | 3:1 | PASS |
| "Later" status label | `--status-later` / `--status-later-bg` | 5.28:1 | 3:1 | PASS |
| "Waiting" status label | `--status-waiting` / `--status-waiting-bg` | 2.99:1 | 3:1 | FAIL |
| "Caught" status label | `--status-caught` / `--status-caught-bg` | 4.48:1 | 3:1 | PASS |
| Neutral status label | `--status-neutral` / `--status-neutral-bg` | 4.85:1 | 3:1 | PASS |

## Non-text UI components (WCAG 1.4.11, >=3:1)

| Usage | Tokens | Ratio | Required | Verdict |
|---|---|---|---|---|
| Default border against the page background | `--border` / `--background` | 1.44:1 | 3:1 | FAIL |
| Input border against the page background | `--input` / `--background` | 1.44:1 | 3:1 | FAIL |

## Failures requiring a product decision

- **Destructive button label** (`--destructive-foreground` on `--destructive`): 3.89:1, below its 4.5:1 requirement.
- **"Waiting" status label** (`--status-waiting` on `--status-waiting-bg`): 2.99:1, below its 3:1 requirement.
- **Default border against the page background** (`--border` on `--background`): 1.44:1, below its 3:1 requirement.
- **Input border against the page background** (`--input` on `--background`): 1.44:1, below its 3:1 requirement.

These are real, measured token failures, not implemented by this pass -- changing brand/status colors is a design decision outside this package's scope. Recorded here so it is not silently missed.

