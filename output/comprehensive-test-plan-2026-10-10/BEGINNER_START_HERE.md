# Start here: test your account and CHRI's account

This is a testing plan, not a report of tests already passed. The full catalog contains 420 cases across 42 areas. Start with the 30 checks below, then work through the catalog in batches. Phone numbers and verification codes are supplied privately during sign-in; they are intentionally absent from these documents.

## Before you click

1. Use an approved test deployment and record its URL, build/commit, date and timezone in EXECUTION_TRACKER.csv. If you only have the live app, use your two authorized accounts and dedicated QA records; do not change existing personal/work items. Never enable a fixed verification code on production just to make testing easier.
2. Open two separate browser profiles: profile A for you, profile B for CHRI. Two normal tabs in one profile share a login and are not two independent users. Normal and private windows can provide separate sessions; two private windows may share one private session, so separate profiles are clearer.
3. Use the two confirmed phone numbers from this conversation and the supplied existing test-mode code. Check the Me page after each login. Do not assume the displayed profile name is CHRI until you verify the signed-in account.
4. Create names starting `QA-YYYYMMDD-run01-`. Use this prefix for every new Thing, List, Bucket, comment and file. Record created IDs for cleanup. Use a tiny harmless PDF/image. Keep tests between A and B; do not message or call unrelated people.
5. Keep both windows visible. When a step changes something, look in the other window first without refreshing, then refresh both. This checks live updates and saved data separately.
6. For each check write PASS, FAIL, BLOCKED, or NOT_RUN, plus what you actually saw. Use N/A only for an approved feature outside this release. An unclear product rule is BLOCKED, not PASS. Screenshots should hide account details and unrelated private data.

## Your first 30 checks

The names of buttons may vary slightly by build. If the described action is absent, record the screen and a failure or specification blocker; do not invent a passing result.

| # | What you do | What you and CHRI should see | Catalog reference |
|---|---|---|---|
| 1 | Sign in as A in profile A. Open Me. | A's own identity; no B data. Record the build. | AUTH |
| 2 | Sign in as B in profile B. Open Me. | B's own identity; A remains A in the other profile. | AUTH, IDENTITY |
| 3 | In A, open Court, Lists, Buckets, Team, Nudges and Me; use Back/Forward. | Each visible route opens; no blank screen, wrong selection or lost login. | NAV |
| 4 | In A's Work context, create a self-assigned Thing `QA-...-self`. | Exactly one saved Thing, correct owner and assignee; no duplicate after refresh. | CAP |
| 5 | Open that Thing and try adding a description. Save and reopen. | Description is discoverable, saved and rendered. If editing rules are undefined, record D02. | DETAIL |
| 6 | Create `QA-...-budget tomorrow at 6 PM`. Inspect the preview and saved details. | Tomorrow at 18:00 in the selected timezone, consistently before and after save. It must not become 22:00. | NLP, TIME |
| 7 | Try `QA-...-budget tomorrow 6 o'clock` without submitting until the preview is inspected. | A visible AM/PM interpretation or clarification; never a silent unrelated 22:00. AM/PM policy needs D01 if undecided. | NLP |
| 8 | Create a harmless task assigned by A to B using the available contact/assignee picker. | A sees B as assignee; A's own personal Now list does not falsely treat it as A's task. B sees an incoming task awaiting Catch. | ASSIGN |
| 9 | In B, open that task and choose Catch. Watch A. | B becomes caught; A sees the updated acknowledgment. Refresh confirms it persisted. | WORK |
| 10 | In B, change the task to In Progress. | Both see “In Progress” with the requested orange treatment; activity identifies B. Internal `under_progress` must not leak as “Under Progress.” | WORK, DETAIL |
| 11 | In B, move personal pace between Now, Next and Later. | B's personal lane changes; A's owner importance remains independent. | PACE |
| 12 | In A, adjust owner importance or due time if the controls are allowed. | The owner setting updates on both sides; B's separately chosen personal pace is preserved. | PACE, TIME |
| 13 | In A, comment `QA-...-comment-A`; B replies `QA-...-comment-B`. | Both comments appear once, in order, with the correct authors, and survive refresh. | COMMENT |
| 14 | In A, type `@`, search B, select the suggestion and send a harmless mention. | B is selectable only when permitted; the selected mention renders and delivers the intended notification once. Merely typed text is a separate D07 test. | MENTION, NOTIFY |
| 15 | Attach a small PDF/image to the permitted task. In B, open it. | Upload completes, filename is correct, and authorized B can view it after refresh. | FILE |
| 16 | Attempt an oversized upload on a QA record. Cancel if the browser becomes resource constrained. | A clear size error and no broken attachment; the configured Thing limit is 50 MiB. | FILE |
| 17 | In B, mark the assigned task Sorted; watch A. | It leaves active lanes for both, updates status/history and does not vanish without a discoverable completed destination. | WORK, ARCHIVE |
| 18 | Find the Sorted task through the app's history/completed destination; inspect recovery controls. | It remains available with its comments/files. Restoration of Sorted items needs an explicit product rule (D04); current cancelled-only reopen is not proof Sorted restore works. | ARCHIVE |
| 19 | Create another A-owned QA task, cancel it as A, and reopen it as A if available. | It leaves active work when cancelled; reopened data and acknowledgment follow the contract. B cannot gain owner-only reopen rights. | WORK, AUTHZ |
| 20 | Switch A from Work to Home, create a Home QA task, then switch back. | Context selection is visible; Work and Home data remain separate after refresh. CHRI sees only appropriately shared content. | CTX |
| 21 | Create a dedicated QA List and add B as collaborator through permitted membership controls. | A remains owner; B sees the shared List and appropriate collaboration controls. | LIST, MEMBER |
| 22 | In that List, create a task and exchange a List chat message between A and B. | Both see the right List association and messages; no duplicate realtime entries. | LIST, CHAT |
| 23 | Create a QA Bucket; add an eligible task; add/edit a note and refresh. | Correct task association and saved note; unrelated private Buckets are absent from B. Shared access must follow the actual Bucket contract. | BUCKET, NOTE |
| 24 | While B is away from a conversation, send one A message, then open it in B. | B's unread indicator increases and clears after reading; A does not inherit B's unread state. | READ |
| 25 | With configured Google Contacts and a disposable address book, sync A's contacts. | Only A's own synced/explicitly accepted contacts appear. Being a Katalist user alone must not add someone to A's contacts. Missing OAuth/configuration is BLOCKED. | GCONTACT, CONNECTION |
| 26 | Repeat Google sync; deny permission on a separate controlled attempt. | No duplicate contacts; denied sync gives useful recovery and does not publish the global user directory. | GCONTACT |
| 27 | Between A and B, start a test call, accept, verify audio, mute/unmute, then end. | Only the intended participants ring/join; mute works; call and media end on both sides. Requires configured calls, permission and audio-capable devices. | CALL |
| 28 | On a new QA comment or task change, simulate a network failure and retry. | The app explains failure, preserves the draft and produces exactly one saved record after recovery. | RECOVERY |
| 29 | Sign A out and back in; separately switch an approved same-browser session from A to B. | Prior identity's drafts, files, counts and delayed responses do not leak to the new user. | IDENTITY |
| 30 | Test the core flow on a phone and using only keyboard on desktop. | Text and controls fit, focus is visible, dialogs are reachable, and actions do not require hover alone. | A11Y, DEVICE |

## When something fails

Record: case ID, build, account alias, Work/Home, browser/device, exact steps, expected result, actual result and timestamp. Save a screenshot or short recording and relevant sanitized error. Example: “A assigned QA-run01-budget to B. After refresh, A's personal Now still contains it and no assignee appears.” Do not just write “assignment broken.”

If you cannot tell whether something is correct, record BLOCKED and the question. Do not change roles, database rows or feature flags just to bypass the missing action. C (outsider), V (view-only) and X (removed member) are extra test fixtures that the broad permission plan needs; A and B alone cannot prove every authorization boundary.

## Move from the beginner checks to the full plan

Open TEST_PLAN.md for run order and prerequisites. TEST_CASES.md explains all 420 cases; TEST_CASES.csv is the spreadsheet version. Fill EXECUTION_TRACKER.csv as you execute. QA_IMPORT.csv can populate the app's QA case library when that feature is enabled and the import is authorized; imported cases are not completed tests. EMERGENT_AUTOMATION_PROMPT.md gives an automation agent the same boundaries and reporting rules.

Clean up only records created for this run and recorded in your fixture ledger. Review cleanup effects on both accounts. Keep failing fixtures until enough evidence has been captured. Do not delete existing account data.

## Testing setup still to complete

[AUTOMATION_READINESS.md](AUTOMATION_READINESS.md) lists 11 open setup/verification items, including simultaneous A/B login automation. The [READINESS_TRACKER.csv](READINESS_TRACKER.csv) records progress. The manual two-profile steps above remain available; writing them does not implement automated login.
