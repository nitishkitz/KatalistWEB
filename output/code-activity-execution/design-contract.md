# Code Activity — T03 Design Contract

**Status: DRAFT — NOT APPROVED.** No design review has taken place. Production UI must not be built from this document yet.
Recorded: 7 October 2026. Companion drafts: `contracts.md` (v3, not reviewed for freeze) and `corrections.md`.

## 1. Source files

| File | Purpose |
|---|---|
| `design/frames.html` | The editable source of all 12 frames and the role matrix. One self-contained HTML file. Open it in a browser. |
| `design/png/frame-01.png` … `frame-12.png`, `frame-roles.png` | Rendered images of each frame at 1x, for review and comment. Produced from `frames.html` with a headless Chromium. |

The HTML was written by hand through a small generator that is not part of the deliverable. Edit `frames.html` directly. Typography is Poppins in the application. The board requests Poppins and falls back to a system font if it cannot load, so text widths can differ slightly from the application.

All people, repositories, and numbers are invented sample data. No job titles appear. No assignee is suggested. The board reproduces the existing application chrome from committed code (`src/components/layout/TopNav.tsx`, `src/routes/lists.$listId.tsx`) rather than from either concept image.

## 2. What changed from the concept images

The two concept images are superseded where they conflict with this document.

| Concept image | This design |
|---|---|
| Sidebar navigation (storyboard) | Existing top navigation: Court, Lists, Buckets, Team, Nudges, Me, plus Catch Up, Work/Home toggle, bell, avatar |
| Shortened labels in the roadmap (Court, Lists, Buckets, Team) | Full existing set, unchanged |
| Job titles and "Suggested based on List role" assignee | Removed. No role-based suggestion. Real List roles (Owner, Collaborator) are shown only in the assignee picker |
| Prefilled due date from "Friday" | Starts **Not set** |
| "Waiting for Catch … will be set after assignment" | Starts as Waiting for Catch for **every** new Thing, including self-assignment. Not editable |
| "Choose a person" implying a blank assignee | Required, starts unselected. An explicit "Assign to me" option exists. Confirm is disabled until chosen |
| "Ask Coey about this List" chat bar | Removed |
| Coey buttons in several places | "Draft with Coey" inside the change inspector only, plus a separate "Summarize change" |
| A bare "Open on GitHub" link in the footer | Always visible in the inspector header |

## 3. Frame index

| # | Frame | Covers |
|---|---|---|
| 01 | Owner sees an unconnected repository | Connect GitHub; sharing notice; non-owner and feature-off variants |
| 02 | Choose a repository and acknowledge sharing | Server-verified choices; URL matching; separate acknowledgement |
| 03 | Loaded feed | Mixed PR and check states; honest syncing; no refresh interval |
| 04 | Selected change: overview | Source links; provider description label; Draft and Summarize actions |
| 05 | Files and patch | File navigator; unified diff; binary and truncated notices |
| 06 | Checks | Failing, running, passed, none, unavailable, stale, partial |
| 07 | Coey input and consent | Consent on; off for Owner and Collaborator; View Only; generated-summary label |
| 08 | Generation | Progress, cancel, timeout, unusable output, consent withdrawn, unavailable |
| 09 | Editable draft | Required assignee; due date unset; Waiting for Catch; notification copy |
| 10 | Creation and recovery | Created, creating, no response, found after retry, source changed, not allowed |
| 11 | State sheet | 16 non-happy states |
| 12 | Mobile sequence | Activity, full-screen inspector, draft, result |
| — | Role matrix | Owner, Collaborator, View Only |

## 4. Layout, spacing, and typography

Values marked **existing** come from committed code. All others are proposed for this feature and require review.

### Existing chrome (reused, not redesigned)

| Element | Value | Source |
|---|---|---|
| Top navigation | 56px high, background `#f5f8fe`, bottom border `#f0f3fb`, active item underlined 3px violet | `TopNav.tsx` |
| Mobile navigation | Existing 56px bottom tab bar (Court, Lists, Buckets, Team, Nudges, Me). Top navigation is hidden below the `md` breakpoint | `Sidebar.tsx`, `TopNav.tsx` |
| Page container | Maximum width 1440px, horizontal padding 32px (16px on mobile) | `AppShell.tsx` |
| List tabs | 13.5px; active ink `#000533`, 500 weight, 2px underline `#975ee2`; inactive `#6a769c`; gap 32px | `lists.$listId.tsx` |
| Ink, muted, hairline | `#000533` / `#6a769c` / `#eef0f6` and `#eaeffa` | same |
| Selected tint | `#f5f4fe` with border `#c9c4fc` | same (filter pill) |
| Buttons | 42px high, radius 9px, 14px text, 500 weight | same |
| Font | Poppins (DM Sans wordmark) | `styles.css` |

### New tab

Add one tab, **Code Activity**, between Chat and Members & Permissions, only when the feature is enabled for the List. The default tab stays Things.

### New elements (proposed)

| Element | Spec |
|---|---|
| Repository strip | 52px high, below the tabs. Repository name in monospace 13px 600; connection chip; last-synced text 13px; right side Refresh and Manage (34px buttons) |
| Desktop split | Activity list 35% (minimum 360px), inspector 65% (minimum 560px), at 1024px and wider. The divider is a 1px `#eef0f6` rule |
| Medium widths (about 768 to 1023px) | Inspector is a wide sheet over the list. Exact breakpoint is open (section 9) |
| Mobile (below 768px) | Inspector and draft review are separate full-screen views |
| Feed row | Minimum 88px; padding 14px 20px. Line 1 title 14px/500 (ellipsis) with change size right-aligned in monospace 12px. Line 2 author, branch (monospace 12px), time at 12px. Line 3 PR pill, check pill, and View change action right-aligned |
| Day group label | 12px/600 muted, padding 14px 20px 6px |
| Inspector header | Padding 20px 28px. Title 20px/600. Pills below. Metadata 12px |
| Inspector tabs | Overview, Files, Checks; 13px; 26px gap; 2px violet underline |
| File navigator | 270px wide; rows about 36px; paths monospace 12px, middle ellipsis; change counts monospace 11.5px |
| Diff | Monospace 12px, line height 20px; two 44px number columns; 18px sign column; hunk header on `#f6f7fb` |
| Cards | Radius 12px, border `#eaeffa`, padding 14 to 32px |
| Form fields | Label 12.5px/600; input minimum height 42px, radius 9px, 14px text; mobile minimum 44px |
| Pills | Radius 6px, padding 1px 8px, 12px/500 |
| Touch targets | 44px minimum on mobile |
| Body text | 14px; metadata 12px or larger |

### Colour

Existing colours are listed above. The check and notice colours below are **proposed for this feature only** and are not existing tokens. Contrast has **not** been measured; T34 must measure it and correct any failure.

| State | Text | Background |
|---|---|---|
| Passed | `#17663f` | `#e6f5ec` |
| Failing | `#a61b2b` | `#fdebed` |
| Running or warning | `#7a4d00` | `#fff2d6` |
| None, closed, draft | `#4d5878` | `#f1f2f6` |
| Added line / removed line | sign `#17663f` / `#a61b2b` | `#e8f7ee` / `#fdecee` |

Colour is never the only cue. Every state pairs an icon glyph and a text label.

## 5. States

| State | Treatment |
|---|---|
| Selected row | Tint `#f5f4fe` and a 3px inset violet bar on the left |
| Hover row | `#fafaff` background; the View change action stays visible |
| Focus | 2px violet focus ring with 2px offset on every interactive element; rings are never removed. Tab order follows reading order |
| Disabled | 45% opacity plus a stated reason nearby (never silent) |
| Error field | Border `#fc404d` plus text; the error is associated with the field |
| Loading | Skeleton rows in the list; spinner and text in the inspector. **Not yet drawn** (section 9) |

Focus return: closing a sheet, pressing Back on mobile, or leaving the draft returns focus to the control that opened it. Selection, filter, and scroll position persist across inspector navigation.

## 6. Motion

Short opacity and position transitions of 160 to 220ms. Honour reduced-motion by removing movement and spinner animation, leaving text status. No looping mascot animation in the reading surface. Generation and creation status is announced through a polite live region.

## 7. Copy rules

- **Sharing notice:** says that repository content becomes readable by all List members, including View Only members. It appears before connecting and again beside the acknowledgement. It is separate from AI consent.
- **Consent off:** content-processing actions are disabled with a reason. Owner: link to consent settings. Collaborator: "Ask the List Owner to enable." Clicking Draft never implies consent.
- **Pull request and check state:** always two separate pills. "Merged" is never presented as "passing."
- **Unknown values:** "size not available," "Unknown author," never a zero or a guess.
- **Provider text:** labelled "Description from GitHub," shown as plain text. Generated text is labelled with its revision and any partial input.
- **Waiting for Catch:** described as the start state of every new Thing. Not an assignment result. Not editable.
- **Assignee:** required, starts unselected. Candidates are the List Owner (shown as "You" when it is the current user) and current Collaborators. View Only members are not offered. "Assign to me" is explicit.
- **Notification:** describe only the verified in-app notification ("A Thing is waiting for your Catch") and only when someone else is chosen. **Do not mention or promise push delivery.**
- **Due date:** "Not set" by default. Never prefilled from words such as "Friday."
- **History:** gaps are named openly. Stale and syncing states show last-synced time and a working indicator. **No refresh interval is stated or implied.**

## 8. Component reuse

| Need | Existing component or pattern | Note |
|---|---|---|
| Shell, navigation | `AppShell`, `TopNav`, `Sidebar` (mobile bar) | Unchanged |
| Avatars | `PersonAvatar` | Initials only in sample data |
| Empty and async states | `EmptyState`, `AsyncState` (kinds include offline, forbidden, failed, loading, empty) | Use where they fit. Frame 11 copy is sample |
| Skeletons | `ui/skeleton` | |
| Cards | `SectionCard`, `ui/card` | |
| Buttons, inputs, checkbox, select | `ui/button`, `ui/input`, `ui/checkbox`, `ui/select` | Match the 42px and 9px spec |
| Medium-width sheet | `ui/sheet` | |
| Confirmation dialogs | `ui/alert-dialog` | For disconnect |
| Status pills | `StatusPill` variants are Thing-status variants (now, next, later, waiting, caught, neutral) | **Do not reuse for PR or check states.** New feature-scoped pills are needed |
| Waiting for Catch label | `AcknowledgementBadge` | Likely reusable for the "Waiting for Catch" display; to confirm at T09 |
| Global tokens | None changed | New styles stay scoped to Code Activity |

New feature-scoped components, per the execution plan: feed and row, change inspector, file diff, draft review, root and error boundary.

## 9. Gaps and open design questions

The designs are drafts and **do not yet cover**:

- The consent settings screen (where the Owner enables private-content processing) and the Manage menu, including the disconnect confirmation dialog.
- A loading skeleton for the feed and inspector.
- A forbidden or unauthorized frame distinct from "feature off."
- A keyboard-focus walkthrough drawn on the diff and draft.
- 200% zoom and the 1024px compact layout drawn explicitly (only specified in text).
- The exact breakpoint between the split view and the sheet.
- A Summarize-change result frame beyond the label shown in frame 07.

Open questions for review:

1. Contrast of the proposed check and notice colours is unmeasured.
2. Poppins fallback widths in the board may differ from the application.
3. Whether a reused `AcknowledgementBadge` suits the Waiting for Catch display.
4. Whether the Manage action opens a menu or a settings page.
5. How an Owner who is not the current user appears in the candidate list ("Alex R." versus "You").

## 10. Approval

| Item | Status |
|---|---|
| Design review of revised frames | **NOT HELD.** Approval has not been recorded |
| Product owner approval of copy | Pending |
| T03 acceptance (plan: "design review records approval") | **NOT MET** |

Until approval is recorded, no production component (T07 onward) should be built from these frames.
