# Katalist: 420 test cases

Plan authored 10 October 2026. Every case starts **NOT_RUN**. Existence of a source file is not execution evidence. Candidate mappings need verification.

Use A for your account and B for CHRI. Additional C/V/X fixtures are required for outsider, viewer and removed-member checks. Use the master plan for decision dependencies and setup.

## AUTH — Phone sign-in and session

Shared prerequisites: Signed-out A and B; approved test deployment; separate browser profiles

Suggested layers: browser + API

Candidate source/tests: `scripts/local-fixed-otp-auth.test.mjs`

### KAT-AUTH-001 · P0 · Correct phone and test code

Actions: Open /auth; select +91; enter A's phone; Send code; enter supplied test code; open Me

Expected: A's own profile and data appear; the session is authenticated as A, never B

Status: NOT_RUN

### KAT-AUTH-002 · P1 · Wrong verification code

Actions: Request a code for A; enter a wrong six-digit code; then enter the correct test code

Expected: Wrong code is rejected without a session; correcting it succeeds without losing the phone input

Status: NOT_RUN

### KAT-AUTH-003 · P1 · Phone validation boundaries

Actions: Submit blank, letters, 9 digits and 11 local digits; then use a valid +91 number

Expected: Invalid inputs show validation and do not send a code or create an account

Status: NOT_RUN

### KAT-AUTH-004 · P1 · Change phone during verification

Actions: Request A's code; choose Change number; enter B's phone; verify

Expected: The final session is B's; A's previous request cannot authenticate the new phone

Status: NOT_RUN

### KAT-AUTH-005 · P1 · Resend countdown and repeat clicks

Actions: Request a code; repeatedly press Send/Resend before and after the displayed countdown

Expected: Countdown is enforced; repeated requests do not create competing sessions or misleading success

Status: NOT_RUN

### KAT-AUTH-006 · P1 · Expired code

Actions: Advance the test clock beyond the displayed code lifetime; submit the old code

Expected: Expired code is rejected or documented test-mode behavior is explicitly recorded; production cannot accept an expired code

Status: NOT_RUN

### KAT-AUTH-007 · P1 · Refresh and deep link after login

Actions: Sign in as A; refresh; open a permitted Thing deep link in the same profile

Expected: A remains signed in; the exact permitted Thing opens without showing B's data

Status: NOT_RUN

### KAT-AUTH-008 · P0 · Logout revokes visible access

Actions: Sign out A; use browser Back; reload a formerly private route

Expected: Private content disappears; requests require a valid session; Back does not expose A's cached data

Status: NOT_RUN

### KAT-AUTH-009 · P0 · Test OTP deployment boundary

Actions: Inspect approved test and real production configurations; submit the test OTP on a non-test deployment

Expected: Fixed OTP is available only in an explicitly approved test environment; accidental public test authentication is a release blocker

Status: NOT_RUN

### KAT-AUTH-010 · P0 · Invalid or expired bearer session

Actions: Call protected contact/task endpoints without a bearer token, with garbage, and with an expired token

Expected: Each request is rejected before privileged database or provider access; no identity is inferred from submitted phone/profile IDs

Status: NOT_RUN

## ONB — Welcome and onboarding

Shared prerequisites: Disposable new account C; completed account A; profile fixtures

Suggested layers: browser + API

Candidate source/tests: `scripts/onboarding-state.test.mjs`

### KAT-ONB-001 · P1 · New-account onboarding

Actions: Sign in to C for the first time; follow each presented onboarding step; reload

Expected: Required steps are discoverable; completed profile and onboarding progress persist

Status: NOT_RUN

### KAT-ONB-002 · P1 · Completed user bypass

Actions: Sign in to A with completed onboarding; navigate to Court

Expected: A reaches the application without repeating onboarding or losing settings

Status: NOT_RUN

### KAT-ONB-003 · P2 · Required field validation

Actions: Submit each required onboarding field empty; correct one field at a time

Expected: Validation identifies the actual missing fields and preserves valid entries

Status: NOT_RUN

### KAT-ONB-004 · P2 · Back navigation preserves draft

Actions: Fill two onboarding steps; go Back then forward

Expected: Draft values remain consistent; no step is silently marked complete

Status: NOT_RUN

### KAT-ONB-005 · P1 · Save failure and retry

Actions: Fail the onboarding save request; retry after restoring the network

Expected: Failure is visible; draft remains; exactly one successful profile update occurs

Status: NOT_RUN

### KAT-ONB-006 · P2 · Long and Unicode names

Actions: Enter a long name, Telugu text, accented characters and emoji; save

Expected: Supported content is preserved and displayed safely without breaking layout

Status: NOT_RUN

### KAT-ONB-007 · P1 · Returning before completion

Actions: Close a partially completed session; sign back in

Expected: Resume behavior follows the approved onboarding contract; missing requirements are not silently skipped

Status: NOT_RUN

### KAT-ONB-008 · P2 · Welcome tour navigation

Actions: Open /welcome; use tour controls and sign-in entry points

Expected: Links reach the intended route; keyboard focus and history remain usable

Status: NOT_RUN

### KAT-ONB-009 · P0 · Cross-account onboarding isolation

Actions: Partially fill C's profile; sign out; sign in to A

Expected: C's draft and progress do not appear in A's profile

Status: NOT_RUN

### KAT-ONB-010 · P2 · Mobile onboarding

Actions: Complete onboarding at 390x844 and with an onscreen keyboard

Expected: Every field and primary action remains reachable without clipped controls

Status: NOT_RUN

## NAV — Navigation and global capture

Shared prerequisites: A authenticated; at least one permitted List, Bucket and conversation

Suggested layers: browser

Candidate source/tests: `tests/e2e/preview/smoke.spec.ts`

### KAT-NAV-001 · P1 · Every main route

Actions: Visit Court, Lists, Buckets, Team, Nudges and Me; refresh each

Expected: Correct page loads and the active navigation item matches the route

Status: NOT_RUN

### KAT-NAV-002 · P1 · Direct resource links

Actions: Open permitted Thing, List, Bucket and conversation links in a new tab

Expected: Exact resources load after authentication; unrelated default content is not substituted

Status: NOT_RUN

### KAT-NAV-003 · P1 · Back and forward

Actions: Open a List then a Thing; use Back and Forward

Expected: History returns to the expected selection and does not duplicate dialogs

Status: NOT_RUN

### KAT-NAV-004 · P1 · Global capture shortcut

Actions: Press the displayed capture shortcut on Court and other routes

Expected: One visible Magic Box is focused; capture is not submitted accidentally

Status: NOT_RUN

### KAT-NAV-005 · P1 · List-scoped capture destination

Actions: Use Create Thing inside a List or Code Activity workspace; submit a test item

Expected: Item belongs to the displayed List; global navigation does not silently change its destination

Status: NOT_RUN

### KAT-NAV-006 · P1 · Unknown and removed resource route

Actions: Open an invalid UUID and a resource no longer visible to A

Expected: Clear unavailable/not-found state appears; private metadata is not disclosed

Status: NOT_RUN

### KAT-NAV-007 · P2 · Navigation while dialog is open

Actions: Open a nonmodal Contacts or detail panel; click another main navigation item

Expected: Panel closes or transitions predictably; clicked destination is reached with correct focus

Status: NOT_RUN

### KAT-NAV-008 · P2 · Search escaping and empty queries

Actions: Enter whitespace, apostrophes, emoji and a URL in each navigation search

Expected: Queries do not crash or navigate unexpectedly; clear search restores the unfiltered view

Status: NOT_RUN

### KAT-NAV-009 · P1 · Capture draft across navigation

Actions: Type a test capture draft; navigate away and return

Expected: Draft retention follows the existing session-draft contract; another account cannot see it

Status: NOT_RUN

### KAT-NAV-010 · P2 · Route-local failure containment

Actions: Force an optional feature to throw while a List is open; navigate to Things or Chat

Expected: Feature error stays local; core navigation and other List tabs remain usable

Status: NOT_RUN

## CTX — Work and Home separation

Shared prerequisites: A/B; distinct Work and Home tasks, chats and buckets

Suggested layers: browser + API

Candidate source/tests: `scripts/app-context-provider-epoch.test.mjs`

### KAT-CTX-001 · P1 · Visible context switch

Actions: Open Court; switch Work to Home and back

Expected: Selected context has a clear visible state and is understandable without color alone

Status: NOT_RUN

### KAT-CTX-002 · P0 · Capture in correct context

Actions: Create one test Thing in Work and one in Home; reload both views

Expected: Each item persists in its intended context and is not misclassified

Status: NOT_RUN

### KAT-CTX-003 · P0 · Chat context separation

Actions: Create Work and Home conversations with distinct text; switch context

Expected: Only conversations for the selected context appear; one does not overwrite the other

Status: NOT_RUN

### KAT-CTX-004 · P1 · Context-specific counts

Actions: Seed different lane, nudge and brief counts in both contexts; toggle

Expected: Counts and empty states match the active context instead of using stale totals

Status: NOT_RUN

### KAT-CTX-005 · P1 · Context persists across reload

Actions: Select Home; reload and navigate through all main routes

Expected: Context follows the approved persistence contract consistently

Status: NOT_RUN

### KAT-CTX-006 · P0 · In-flight context race

Actions: Start a delayed Work capture/read; switch Home before it returns

Expected: Result cannot be displayed or created as a Home item accidentally

Status: NOT_RUN

### KAT-CTX-007 · P1 · Contacts shared across contexts

Actions: Accept a contact in Work; switch Home

Expected: The contact remains shared while its conversations stay context-specific

Status: NOT_RUN

### KAT-CTX-008 · P1 · Deep link to other-context item

Actions: Open a permitted Home Thing link while Work is active

Expected: Context transition or explicit explanation preserves the identity of the linked Thing

Status: NOT_RUN

### KAT-CTX-009 · P1 · Empty Home state

Actions: Leave Home empty while Work contains many Things; switch Home

Expected: Home shows its own empty state rather than Work records or a spinner forever

Status: NOT_RUN

### KAT-CTX-010 · P0 · Account plus context switch

Actions: Switch A/Home to B/Work with requests pending

Expected: No A data, drafts or selected-context history leaks to B

Status: NOT_RUN

## CAP — Magic Box task capture

Shared prerequisites: A; test prefix; known List and contact B; isolated writes

Suggested layers: browser + integration

Candidate source/tests: `scripts/magic-box-capture-ux.test.mjs`

### KAT-CAP-001 · P1 · Plain task creation

Actions: Enter QA-[run]-plain Send budget file; click Toss; open the result; reload

Expected: One Thing exists with the intended title, owner, assignee and context

Status: NOT_RUN

### KAT-CAP-002 · P1 · Blank and whitespace capture

Actions: Submit empty input and whitespace-only input

Expected: No empty Thing is created; validation or disabled submission is clear

Status: NOT_RUN

### KAT-CAP-003 · P1 · Double submission

Actions: Double-click Toss and press Enter repeatedly during a delayed response

Expected: At most one logical submission is stored; duplicate behavior is detected rather than hidden

Status: NOT_RUN

### KAT-CAP-004 · P1 · Creation failure retains text

Actions: Fail the create request; try again

Expected: Draft text and attachments remain available; no false success is shown

Status: NOT_RUN

### KAT-CAP-005 · P1 · Due and pace preview

Actions: Enter a task containing an explicit time and urgency; inspect chips before submitting

Expected: Preview values equal stored values after creation; due and pace are independent

Status: NOT_RUN

### KAT-CAP-006 · P1 · Assignment from capture

Actions: Select B as assignee in capture; submit; open both accounts

Expected: B receives the intended Thing; A's outgoing task shows B visibly

Status: NOT_RUN

### KAT-CAP-007 · P1 · File with capture

Actions: Attach a small supported fixture; submit; reload detail

Expected: Exactly the intended file is associated with the new Thing and remains downloadable

Status: NOT_RUN

### KAT-CAP-008 · P2 · Clear input semantics

Actions: Type a draft with a parsed date and pending file; use Clear input

Expected: Clearing follows the approved draft/file contract; no stale chip changes the next submission

Status: NOT_RUN

### KAT-CAP-009 · P1 · Navigation during submission

Actions: Submit in List L1; navigate to L2 before the response

Expected: Created Thing remains in L1; pending completion cannot inject it into L2

Status: NOT_RUN

### KAT-CAP-010 · P2 · Long title boundary

Actions: Capture at the actual configured maximum title length and one character beyond

Expected: Boundary is accepted; excess has explicit validation and is not silently truncated

Status: NOT_RUN

## NLP — Natural-language date and text interpretation

Shared prerequisites: Frozen clock; Asia/Kolkata; parser and persisted create results

Suggested layers: unit + browser

Candidate source/tests: `scripts/magic-box-natural-language.test.mjs`

### KAT-NLP-001 · P1 · Explicit evening time

Actions: Capture Send budget tomorrow at 6 PM; inspect chip and persisted dueAt

Expected: Due date is tomorrow at 18:00 local; explicit time is not replaced with 22:00

Status: NOT_RUN

### KAT-NLP-002 · P1 · Explicit morning time

Actions: Capture Send budget tomorrow at 6 AM; reload detail

Expected: Due date is tomorrow at 06:00 local in preview and storage

Status: NOT_RUN

### KAT-NLP-003 · P1 · O'clock wording

Actions: Enter tomorrow 6 o'clock and tomorrow 6 o clock; inspect parser output

Expected: Six is recognized as the supplied hour and never silently becomes ten; AM/PM behavior requires D01

Status: NOT_RUN · Product decisions: D01

### KAT-NLP-004 · P1 · 24-hour and minute precision

Actions: Capture tomorrow at 18:30, at 06:05 and at 23:59

Expected: Exact local hour and minute survive preview, storage and reload

Status: NOT_RUN

### KAT-NLP-005 · P1 · Untimed due-date policy

Actions: Capture Send budget tomorrow with no clock time

Expected: Current 22:00 default is tested separately from explicit-time input; product approval of this default requires D01

Status: NOT_RUN · Product decisions: D01

### KAT-NLP-006 · P1 · Invalid calendar date

Actions: Enter 31 February and a non-leap-year 29 February

Expected: Input is flagged; JavaScript date rollover cannot silently change the intended date

Status: NOT_RUN

### KAT-NLP-007 · P2 · Weekday and end-of-period phrases

Actions: Test Friday, next week, next month, this year and next year at calendar boundaries

Expected: Each phrase resolves consistently with an approved reference table; ambiguous phrases require D01

Status: NOT_RUN · Product decisions: D01

### KAT-NLP-008 · P1 · URL immunity to parsing

Actions: Capture a URL containing /today, #next, digits, query strings and trailing punctuation

Expected: URL is preserved verbatim and not interpreted as due, pace or bucket metadata

Status: NOT_RUN

### KAT-NLP-009 · P1 · Temporal phrase removal

Actions: Capture Send budget tomorrow at 6 PM; compare resulting title and description

Expected: Only recognized scheduling words are removed; meaningful task wording is preserved

Status: NOT_RUN

### KAT-NLP-010 · P2 · Multiple conflicting dates

Actions: Enter tomorrow at 6 PM and Friday at 9 AM in the same task

Expected: Parser exposes ambiguity or follows an approved documented precedence; D01 is required

Status: NOT_RUN · Product decisions: D01

## TIME — Timezones and scheduled boundaries

Shared prerequisites: A in Asia/Kolkata; B in America/New_York; frozen clocks

Suggested layers: unit + integration + browser

Candidate source/tests: `scripts/meeting-reminder-timezone.test.mjs`

### KAT-TIME-001 · P1 · Same instant across accounts

Actions: Create a due time in A; open the same Thing in B's timezone

Expected: Both displays represent the same stored instant with appropriate local labels

Status: NOT_RUN

### KAT-TIME-002 · P1 · Midnight local boundary

Actions: Create tomorrow tasks at 23:59 and 00:01 local

Expected: Tomorrow follows the creator's local calendar policy; no UTC date shift occurs

Status: NOT_RUN

### KAT-TIME-003 · P1 · Month and year rollover

Actions: Create due dates on 31 December and the final day of a month

Expected: Date advances to the intended next month/year without overflow errors

Status: NOT_RUN

### KAT-TIME-004 · P1 · Leap-day boundary

Actions: Use 28 February in leap and non-leap years; create tomorrow and explicit 29 February

Expected: Valid leap day works; invalid leap day is rejected

Status: NOT_RUN

### KAT-TIME-005 · P1 · Daylight-saving skipped hour

Actions: Schedule a nonexistent local time in a DST timezone

Expected: No silently invented instant; behavior follows an approved timezone policy under D01

Status: NOT_RUN · Product decisions: D01

### KAT-TIME-006 · P1 · Daylight-saving repeated hour

Actions: Schedule a repeated local time at DST fallback

Expected: Chosen offset is explicit or follows D01; repeated hour does not trigger duplicate reminders

Status: NOT_RUN · Product decisions: D01

### KAT-TIME-007 · P1 · Overdue transition

Actions: Freeze before due time; advance one minute beyond it; inspect A and B

Expected: Needs Attention and due indicators change according to the stored instant

Status: NOT_RUN

### KAT-TIME-008 · P1 · Terminal task due time

Actions: Sort a due Thing; advance beyond its due time

Expected: Sorted item does not become an active overdue task or receive active-task reminders

Status: NOT_RUN

### KAT-TIME-009 · P2 · Locale format variation

Actions: View a timed Thing under supported 12-hour and 24-hour locales

Expected: Display format may differ but hour, minute, date and underlying timestamp stay identical

Status: NOT_RUN

### KAT-TIME-010 · P1 · Snooze boundary precision

Actions: Snooze a fixture near midnight and month end; reload both accounts

Expected: Approved snooze destination/time is preserved; D05 defines the exact snooze rule

Status: NOT_RUN · Product decisions: D05

## ASSIGN — Assignment and reassignment

Shared prerequisites: A owner; B assignee; C unrelated; one private and one List Thing

Suggested layers: browser + API + DB

Candidate source/tests: `scripts/katalist-permissions.test.mjs`

### KAT-ASSIGN-001 · P1 · A assigns to B

Actions: Create a test Thing owned by A; assign B; open A and B side by side

Expected: A sees an outgoing item labelled B; B sees incoming item in the owner's importance lane

Status: NOT_RUN

### KAT-ASSIGN-002 · P1 · Task leaves A's personal lanes

Actions: Assign an A-self Thing in Now to B; refresh both ends

Expected: It leaves A's personal Now/Next/Later lanes; legitimate With Others visibility remains

Status: NOT_RUN

### KAT-ASSIGN-003 · P1 · Assignee label consistency

Actions: Inspect Court card, With Others, detail, List and activity after assigning B

Expected: All surfaces resolve B's identity; no stale You or A badge remains

Status: NOT_RUN

### KAT-ASSIGN-004 · P1 · Reassign after Catch

Actions: B catches the Thing; use permitted reassign action to A; refresh

Expected: Current assignee changes correctly; permissions and acknowledgment reset according to the approved state contract

Status: NOT_RUN

### KAT-ASSIGN-005 · P0 · Owner restrictions on assigned task

Actions: A attempts Catch, personal pace and Sort on a Thing currently assigned to B

Expected: Owner cannot perform assignee-only actions in UI or direct API requests

Status: NOT_RUN

### KAT-ASSIGN-006 · P0 · Former assignee loses workflow rights

Actions: Move task from B to A; B uses a previously open dialog and direct mutation

Expected: B's workflow mutation is rejected and UI updates; unrelated visibility changes follow the access contract

Status: NOT_RUN

### KAT-ASSIGN-007 · P1 · Concurrent reassignment

Actions: A and caught B reassign the same fixture concurrently

Expected: A single authoritative final assignee is visible on both ends; no split state or duplicated task results

Status: NOT_RUN

### KAT-ASSIGN-008 · P1 · Actor and profile ID resolution

Actions: Assign B through profile-ID and actor-ID entry paths

Expected: Both paths resolve the same valid actor; unrelated or malformed IDs fail clearly

Status: NOT_RUN

### KAT-ASSIGN-009 · P1 · Newly added List member

Actions: Add B to a List; immediately open its assign picker

Expected: B is selectable without using unrelated global/demo users or stale roster data

Status: NOT_RUN

### KAT-ASSIGN-010 · P1 · Assignment save failure

Actions: Fail the assignment request after selecting B

Expected: A's old assignee is restored; error is visible; B is not notified of a failed assignment

Status: NOT_RUN

## WORK — Catch and work-status lifecycle

Shared prerequisites: A owner/B assignee; waiting, caught, in-progress, sorted and cancelled fixtures

Suggested layers: unit + browser + DB

Candidate source/tests: `scripts/katalist-state.test.mjs`

### KAT-WORK-001 · P1 · Incoming Catch

Actions: B opens an active waiting Thing and presses Catch; A observes

Expected: Acknowledgment becomes caught once; both accounts show consistent acknowledgment and activity

Status: NOT_RUN

### KAT-WORK-002 · P0 · Catch role enforcement

Actions: A owner of B's item and C outsider attempt Catch by API

Expected: Both unauthorized attempts fail without changing state

Status: NOT_RUN

### KAT-WORK-003 · P1 · Begin work

Actions: B catches then starts the Thing

Expected: Internal under_progress state displays the approved In Progress label and orange presentation

Status: NOT_RUN

### KAT-WORK-004 · P1 · Mark Sorted

Actions: B sorts a caught in-progress item; A observes and refreshes

Expected: One terminal sorted state and timestamp appear; active lane counts decrease consistently

Status: NOT_RUN

### KAT-WORK-005 · P1 · Cancel as owner

Actions: A cancels an active item assigned to B

Expected: Item becomes cancelled and leaves active lanes; B cannot continue workflow actions

Status: NOT_RUN

### KAT-WORK-006 · P0 · Assignee cannot cancel owner task

Actions: B attempts Cancel on A-owned task through UI and API

Expected: Owner-only permission is enforced independently of UI controls

Status: NOT_RUN

### KAT-WORK-007 · P1 · Reopen cancelled Thing

Actions: A reopens a cancelled fixture; B observes

Expected: State returns to not_started, cancellation clears and acknowledgment returns to waiting_for_catch

Status: NOT_RUN

### KAT-WORK-008 · P0 · Reopen permission and status guard

Actions: B/C try reopen; A tries reopen on an active or sorted item

Expected: Unauthorized or unsupported transitions fail; current implementation permits owner reopen of cancelled only

Status: NOT_RUN

### KAT-WORK-009 · P1 · Repeated terminal mutation

Actions: Double-click Sort/Cancel or repeat the same request

Expected: State, timestamps and activity remain coherent; duplicate events are detected

Status: NOT_RUN

### KAT-WORK-010 · P1 · Mutation error rollback

Actions: Fail Catch or Sort after optimistic UI update

Expected: Both local surface and authoritative record revert; unsaved state is not reported as success

Status: NOT_RUN

## PACE — Owner importance and personal pace

Shared prerequisites: A owner/B assignee; one waiting and one caught Thing

Suggested layers: unit + browser + DB

Candidate source/tests: `scripts/set-personal-pace-retry.test.mjs`

### KAT-PACE-001 · P1 · Owner's initial lane

Actions: A captures with Later importance and assigns B without Catch

Expected: B's waiting Thing appears in Later, not forced into Now

Status: NOT_RUN

### KAT-PACE-002 · P1 · Personal pace after Catch

Actions: B catches and chooses Now, Next, then Later

Expected: B's lane follows personal pace; each choice persists after refresh

Status: NOT_RUN

### KAT-PACE-003 · P0 · Pace before Catch

Actions: B tries setting personal pace on a waiting Thing by UI and direct RPC

Expected: Operation is unavailable or rejected before Catch

Status: NOT_RUN

### KAT-PACE-004 · P0 · Owner cannot set another's pace

Actions: A tries modifying B's personal pace

Expected: A's ownership does not grant this assignee-only permission

Status: NOT_RUN

### KAT-PACE-005 · P1 · Importance and pace independent

Actions: A sets owner importance Now; caught B chooses Later

Expected: Owner importance and B's pace remain distinct and consistently displayed

Status: NOT_RUN

### KAT-PACE-006 · P1 · Drag between lanes

Actions: B drags a caught Thing Now to Next and then Later

Expected: Valid lane move changes pace once and matches detail after reload

Status: NOT_RUN

### KAT-PACE-007 · P1 · Invalid lane drag

Actions: Drag a waiting, sorted, cancelled or non-assigned Thing into a lane

Expected: Unsupported drag cannot mutate the task or produce false placement

Status: NOT_RUN

### KAT-PACE-008 · P1 · Pace update network error

Actions: Fail a lane move; restore network; retry

Expected: Old lane is restored on failure; retry succeeds without duplicate work

Status: NOT_RUN

### KAT-PACE-009 · P1 · Sort independent of pace

Actions: B sorts items in each pace lane

Expected: All sorted items leave active lanes regardless of former pace

Status: NOT_RUN

### KAT-PACE-010 · P2 · Counts and lane view-all

Actions: Change pace with more items than stack preview limit

Expected: Lane counts and View all include the complete authoritative set, not just loaded cards

Status: NOT_RUN

## DETAIL — Thing details and descriptions

Shared prerequisites: A/B; task with title, description, due time, files and activity

Suggested layers: browser + integration

Candidate source/tests: `scripts/detail-capsule-model.test.mjs`

### KAT-DETAIL-001 · P1 · Complete detail rendering

Actions: Open a fully populated Thing from Court and List

Expected: Title, actual owner/assignee, description, due, pace, files and status agree

Status: NOT_RUN

### KAT-DETAIL-002 · P1 · Description visibility

Actions: Create or seed a nonempty multiline description; open detail on A and B

Expected: Stored description is visibly readable; no valid description is silently omitted

Status: NOT_RUN

### KAT-DETAIL-003 · P1 · Description creation/edit contract

Actions: Try adding and editing a description through supported UI; reload both accounts

Expected: Approved editing fields and role restrictions persist correctly; missing editing contract is D02

Status: NOT_RUN · Product decisions: D02

### KAT-DETAIL-004 · P2 · Empty description state

Actions: Open a Thing with null, empty and whitespace descriptions

Expected: Approved empty state is clear without suggesting description data was lost

Status: NOT_RUN

### KAT-DETAIL-005 · P1 · Due-time detail fidelity

Actions: Open a task due tomorrow at 18:30 from each entry point

Expected: Exact date and time remain visible where required; details cannot misleadingly hide an explicit time

Status: NOT_RUN

### KAT-DETAIL-006 · P1 · Detail loading and unavailable counts

Actions: Delay detail fetch and fail comments/attachments counts

Expected: Loading/error states are distinct from zero comments or zero files

Status: NOT_RUN

### KAT-DETAIL-007 · P1 · Dialog focus and close

Actions: Open detail by keyboard; inspect focus; Escape or close; reopen

Expected: Focus is managed correctly; correct Thing remains selected; no accidental mutation occurs

Status: NOT_RUN

### KAT-DETAIL-008 · P1 · Selection changes during slow read

Actions: Open Thing T1; immediately open T2 before T1 resolves

Expected: Late T1 response cannot overwrite T2's title, files, assignee or actions

Status: NOT_RUN

### KAT-DETAIL-009 · P2 · Long content rendering

Actions: Use long title, long description, links, Unicode and line breaks

Expected: Content remains safe, scrollable and readable without covering actions

Status: NOT_RUN

### KAT-DETAIL-010 · P0 · Lost access with open detail

Actions: Remove B's resource access while detail is open; B refreshes and tries mutation

Expected: Sensitive detail and actions are retired; server rejects unauthorized follow-up requests

Status: NOT_RUN

## COMMENT — Thing comments and drafts

Shared prerequisites: A/B with allowed access; C outsider; fresh task

Suggested layers: browser + API + DB

Candidate source/tests: `scripts/thing-detail-comment-draft-failure.test.mjs`

### KAT-COMMENT-001 · P1 · A comments and B receives

Actions: A posts QA-[run]-comment; B opens the same Thing; refresh both

Expected: One comment with correct author and text appears on both ends

Status: NOT_RUN

### KAT-COMMENT-002 · P1 · B replies and A receives

Actions: B replies on A-owned permitted Thing

Expected: Reply persists and is attributed to B; A receives the intended unread update

Status: NOT_RUN

### KAT-COMMENT-003 · P1 · Blank comment validation

Actions: Submit blank and whitespace-only replies

Expected: No empty comment is created; Send remains disabled or validates clearly

Status: NOT_RUN

### KAT-COMMENT-004 · P1 · Failed send retains draft

Actions: Fail comment submission with text and pending file; retry

Expected: Text/file draft stays available; successful retry creates one logical comment

Status: NOT_RUN

### KAT-COMMENT-005 · P1 · Repeated send and slow network

Actions: Double-click Send and press Enter repeatedly while delayed

Expected: Duplicate comment creation is prevented or detected; pending UI reflects actual operation

Status: NOT_RUN

### KAT-COMMENT-006 · P1 · Large comment history

Actions: Seed several pages of comments; load older pages while new reply arrives

Expected: No missing or duplicate comments; chronology and scroll position remain coherent

Status: NOT_RUN

### KAT-COMMENT-007 · P1 · Switch Things with draft

Actions: Draft in T1; open T2; return to T1

Expected: Each Thing has its own draft according to session-draft policy

Status: NOT_RUN

### KAT-COMMENT-008 · P0 · Comment authorization

Actions: C guesses a Thing ID and posts; removed B retries a stale reply

Expected: Server denies unauthorized comments; UI visibility alone is not the authorization mechanism

Status: NOT_RUN

### KAT-COMMENT-009 · P2 · Comment content safety

Actions: Post links, HTML-looking text, quotes, Unicode and emoji

Expected: Text is safely rendered; scripts/markup do not execute; supported links are usable

Status: NOT_RUN

### KAT-COMMENT-010 · P1 · Comment write/read agreement

Actions: Post a comment then fail the follow-up read

Expected: Stored success is not falsely reported as a failed send that encourages duplicate posting

Status: NOT_RUN

## MENTION — People mentions and delivery

Shared prerequisites: A/B authorized participants; C excluded; permitted Thing and chats

Suggested layers: browser + API

Candidate source/tests: `scripts/mention-trigger.test.mjs`

### KAT-MENTION-001 · P1 · Typing @ opens people picker

Actions: In a permitted comment, type @ then B's name prefix

Expected: Picker appears and offers authorized participants including B

Status: NOT_RUN

### KAT-MENTION-002 · P1 · Mention icon opens picker

Actions: Use the @ icon rather than typing

Expected: Same authorized picker opens with keyboard focus and usable selection

Status: NOT_RUN

### KAT-MENTION-003 · P1 · Keyboard selection

Actions: Type @; use arrows, Enter and Escape to select/cancel B

Expected: Selection inserts a structured B mention; Escape dismisses without sending

Status: NOT_RUN

### KAT-MENTION-004 · P1 · Mention reaches recipient

Actions: A sends a B mention; inspect B's notification and Thing

Expected: B is notified once; destination opens the exact permitted Thing/comment

Status: NOT_RUN

### KAT-MENTION-005 · P0 · No unauthorized directory disclosure

Actions: C or nonmember opens mention search for a private List/Thing

Expected: Picker and server do not expose or authorize unrelated private participants

Status: NOT_RUN

### KAT-MENTION-006 · P1 · Plain text vs structured mention

Actions: Compare typed @B plain text with a selected B token

Expected: Only approved mention representations drive notifications; contract is D07 if plain text detection is expected

Status: NOT_RUN · Product decisions: D07

### KAT-MENTION-007 · P1 · Duplicate and multiple mentions

Actions: Mention B twice and A once; submit

Expected: Token display is correct; notification duplication follows the documented recipient dedupe contract

Status: NOT_RUN

### KAT-MENTION-008 · P1 · Removed member mentioned from stale draft

Actions: Select B; revoke B's membership; submit stale draft

Expected: Server rechecks visibility; removed person gets no private task/chat content

Status: NOT_RUN

### KAT-MENTION-009 · P1 · Mention notification failure

Actions: Store comment while push delivery fails

Expected: Comment remains stored once; delivery failure does not trigger duplicate comment creation

Status: NOT_RUN

### KAT-MENTION-010 · P2 · Caret and Unicode boundaries

Actions: Type email addresses, punctuation, Unicode name and @ in the middle of text

Expected: Email/plain-text input is not corrupted; caret placement and replacement are correct

Status: NOT_RUN

## FILE — Attachment upload and previews

Shared prerequisites: Small image/PDF/DOCX/video fixtures; exact 50 MiB and over-limit fixtures

Suggested layers: browser + integration

Candidate source/tests: `scripts/process-file-for-upload-size-cap.test.mjs`

### KAT-FILE-001 · P1 · Small file end-to-end

Actions: Attach supported fixture to a Thing; save; B previews/downloads

Expected: File bytes, name, association and permissions are correct after reload

Status: NOT_RUN

### KAT-FILE-002 · P1 · File size boundary

Actions: Upload just below, exactly at and one byte above the 50 MiB limit

Expected: At/below configured limit works; over-limit rejection is explicit before unnecessary upload

Status: NOT_RUN

### KAT-FILE-003 · P1 · Multiple attachment batch

Actions: Attach several files of different supported types; submit

Expected: Every successful file is attached exactly once and failures are individually identifiable

Status: NOT_RUN

### KAT-FILE-004 · P1 · Partial upload failure

Actions: Fail one file in a multi-file submission; retry that file

Expected: Successful uploads remain coherent; failed file is retained for retry without duplicate attachments

Status: NOT_RUN

### KAT-FILE-005 · P1 · Remove pending file

Actions: Select a file then remove it before submission

Expected: Removed file is not uploaded/attached; local preview resources are released

Status: NOT_RUN

### KAT-FILE-006 · P1 · Upload then navigate away

Actions: Start delayed upload; close detail or switch Things/accounts

Expected: Late completion cannot attach to the wrong Thing/account or crash an unmounted UI

Status: NOT_RUN

### KAT-FILE-007 · P1 · PDF preview paging

Actions: Preview a multi-page PDF; change pages rapidly and close/reopen

Expected: Correct page renders; stale canvas work does not overwrite the selected page

Status: NOT_RUN

### KAT-FILE-008 · P2 · Unsupported preview format

Actions: Attach allowed file with no supported in-app preview

Expected: Clear download/fallback is offered; broken viewer does not block the task

Status: NOT_RUN

### KAT-FILE-009 · P1 · Expired signed URL refresh

Actions: Expire an attachment URL; request preview/download again

Expected: Authorized re-sign succeeds or clear unavailable state appears; no invented URL is used

Status: NOT_RUN

### KAT-FILE-010 · P1 · File metadata consistency

Actions: Compare card attachment count, detail list and actual storage associations

Expected: Counts reflect the authoritative set; unavailable counts are not claimed as zero

Status: NOT_RUN

## FILESEC — Private file authorization and unsafe content

Shared prerequisites: A private files; B permitted then revoked; C outsider; malicious fixture text

Suggested layers: API + DB + browser

Candidate source/tests: `scripts/pdf-viewer-private-file-policy.test.mjs`

### KAT-FILESEC-001 · P0 · Outsider signing denial

Actions: C asks sign-attachments endpoint for A's private attachment IDs

Expected: Signing is denied before storage tokens are issued

Status: NOT_RUN

### KAT-FILESEC-002 · P0 · Revoked reader signing denial

Actions: Remove B's membership; B requests a fresh attachment signature

Expected: Fresh signing fails; previously issued URL expiry policy is documented under D08

Status: NOT_RUN · Product decisions: D08

### KAT-FILESEC-003 · P0 · Storage path tampering

Actions: Change Thing ID, storage key and completion payload to another user's object

Expected: Server validates association/ownership; arbitrary object attachment/signing fails

Status: NOT_RUN

### KAT-FILESEC-004 · P0 · Anonymous storage access

Actions: Fetch a private object without signature or authenticated access

Expected: Private bytes and identifying metadata are not disclosed

Status: NOT_RUN

### KAT-FILESEC-005 · P1 · Zero-byte or corrupt files

Actions: Upload permitted empty/corrupt PDF and image fixtures

Expected: Safe validation/viewer failure appears; application and other attachments remain usable

Status: NOT_RUN

### KAT-FILESEC-006 · P0 · MIME and extension disagreement

Actions: Upload nonimage bytes named .png and unsafe active content with plausible extension

Expected: Validation follows content policy; active content does not execute in the app

Status: NOT_RUN

### KAT-FILESEC-007 · P0 · Filename/path injection

Actions: Upload filenames with ../, quotes, HTML markup and control characters

Expected: Storage path is server controlled; names render safely without path traversal or script execution

Status: NOT_RUN

### KAT-FILESEC-008 · P0 · Content access after account switch

Actions: Open A's PDF then sign out and sign in as B

Expected: A's private preview/Blob URL is removed; B cannot reuse A's cached signing authority

Status: NOT_RUN

### KAT-FILESEC-009 · P1 · Orphan cleanup after failure

Actions: Abort upload after storage write but before attachment completion

Expected: Orphan is cleaned according to lifecycle policy; retry cannot claim unrelated files

Status: NOT_RUN

### KAT-FILESEC-010 · P0 · Evidence and secret redaction

Actions: Capture failure screenshots/logs containing tokens, passwords or signed URLs

Expected: Reports redact secrets and restrict private media; evidence cannot become a new disclosure route

Status: NOT_RUN

## LIST — Lists and resource details

Shared prerequisites: A owns L1; B collaborator; C outsider; empty and large List fixtures

Suggested layers: browser + API + DB

Candidate source/tests: `tests/e2e/preview/lists-buckets.spec.ts`

### KAT-LIST-001 · P1 · Create List

Actions: A creates QA-[run]-L1; open it; refresh

Expected: One List exists with A as owner and correct name/context

Status: NOT_RUN

### KAT-LIST-002 · P1 · List title rename

Actions: A renames L1; B observes and both refresh

Expected: Name agrees in navigation, detail, linked tasks and selector surfaces

Status: NOT_RUN

### KAT-LIST-003 · P1 · Empty List

Actions: Open an empty List and each enabled tab

Expected: Clear empty states appear; counts do not imply loading failures are empty data

Status: NOT_RUN

### KAT-LIST-004 · P1 · Create Thing inside List

Actions: Capture QA-[run]-List-task while viewing L1

Expected: Task is associated with L1 and appears in the correct scoped Things view

Status: NOT_RUN

### KAT-LIST-005 · P1 · List task filters

Actions: Combine pace/status/assignee/search filters with pagination

Expected: Only matching accessible Things appear; counts and selection match filters

Status: NOT_RUN

### KAT-LIST-006 · P1 · List overview count integrity

Actions: Seed more Things than one page; compare card counts and all pages

Expected: Overview uses authoritative counts, not loaded-page length

Status: NOT_RUN

### KAT-LIST-007 · P1 · List detail error and retry

Actions: Fail List detail fetch; retry after network returns

Expected: Error is visible; retry loads actual List; fabricated empty details are not substituted

Status: NOT_RUN

### KAT-LIST-008 · P1 · Archive/restore List contract

Actions: Attempt supported archive/restore actions on a disposable List

Expected: Approved visibility and restoration behavior occurs; absent contract is D04

Status: NOT_RUN · Product decisions: D04

### KAT-LIST-009 · P0 · Unknown/unauthorized List link

Actions: C opens L1 by guessed ID or route

Expected: Private List title, members, tasks, files and chat are not revealed

Status: NOT_RUN

### KAT-LIST-010 · P1 · List tab switching preserves identity

Actions: Switch rapidly among Things, Chat, Members, Designs and optional tabs

Expected: Every pane remains tied to L1; slow prior responses do not render under another List

Status: NOT_RUN

## MEMBER — List membership and role controls

Shared prerequisites: A List owner; B collaborator; V view-only; C outsider

Suggested layers: browser + API + DB

Candidate source/tests: `scripts/katalist-permissions.test.mjs`

### KAT-MEMBER-001 · P1 · Add authorized List member

Actions: A adds permitted B to L1; B refreshes

Expected: B gains approved List visibility; roster, assignment candidates and permissions agree

Status: NOT_RUN

### KAT-MEMBER-002 · P0 · Owner-only role administration

Actions: B/V/C try add/remove/change-role endpoints on L1

Expected: Unauthorized administration fails in backend as well as UI

Status: NOT_RUN

### KAT-MEMBER-003 · P1 · Collaborator capabilities

Actions: As B, use allowed task/chat collaboration in L1

Expected: Collaborator actions succeed only where individual Thing capability also permits them

Status: NOT_RUN

### KAT-MEMBER-004 · P0 · View-only workflow restrictions

Actions: V attempts task assignment, Catch, Sort, pace change and List chat send

Expected: Workflow/chat mutations are blocked according to current List capabilities

Status: NOT_RUN

### KAT-MEMBER-005 · P1 · View-only permitted commenting

Actions: V comments on a visible Thing in L1

Expected: Commenting follows current canComment contract while workflow mutation stays blocked

Status: NOT_RUN

### KAT-MEMBER-006 · P0 · Immediate membership removal

Actions: A removes B while B has L1 open; B retries reads and writes

Expected: New reads/writes fail; private UI retires rather than continuing from stale permissions

Status: NOT_RUN

### KAT-MEMBER-007 · P0 · Role downgrade with open composer

Actions: Downgrade B to view-only while B is drafting chat or workflow action

Expected: Submission rechecks role and fails without leaking private content or losing unrelated drafts

Status: NOT_RUN

### KAT-MEMBER-008 · P1 · Duplicate membership addition

Actions: A adds B twice or concurrently

Expected: Roster has one membership; counts/roles remain consistent

Status: NOT_RUN

### KAT-MEMBER-009 · P0 · Owner removal and ownership transfer

Actions: Attempt to remove/demote List owner through each endpoint

Expected: Ownership invariant is preserved; unsupported transfer requires D09 rather than invented success

Status: NOT_RUN · Product decisions: D09

### KAT-MEMBER-010 · P1 · Member naming and actor identity

Actions: Add two members with same first name and different IDs

Expected: Roster and assignment remain ID based; identical names do not collapse distinct users

Status: NOT_RUN

## BUCKET — Buckets and task organization

Shared prerequisites: A/B; personal Buckets; mixed task states; large fixture

Suggested layers: browser + API + DB

Candidate source/tests: `scripts/katalist-buckets.test.mjs`

### KAT-BUCKET-001 · P1 · Create and rename Bucket

Actions: A creates QA-[run]-Bucket; renames; refreshes

Expected: Bucket persists with correct owner/context/name

Status: NOT_RUN

### KAT-BUCKET-002 · P1 · Add Thing to Bucket

Actions: Add a permitted Thing through detail and drag path

Expected: Bucket membership persists once; task ownership/assignee do not change

Status: NOT_RUN

### KAT-BUCKET-003 · P1 · Remove Thing from Bucket

Actions: Remove association through Bucket UI; inspect Court and List

Expected: Only organization association changes; the underlying Thing remains intact

Status: NOT_RUN

### KAT-BUCKET-004 · P1 · Bucket progress deduplication

Actions: Associate the same task through overlapping direct/List paths

Expected: Progress counts the intended unique task set; duplicate associations do not inflate totals

Status: NOT_RUN

### KAT-BUCKET-005 · P1 · Sorted and cancelled progress

Actions: Sort/cancel fixtures in a Bucket; inspect progress after reload

Expected: Progress uses approved denominator and terminal-state rules; ambiguous semantics are D10

Status: NOT_RUN · Product decisions: D10

### KAT-BUCKET-006 · P1 · Bucket empty and error states

Actions: Open empty Bucket; separately fail populated Bucket fetch

Expected: True empty state is distinct from unavailable data and supports retry

Status: NOT_RUN

### KAT-BUCKET-007 · P1 · Large Bucket pagination

Actions: Seed many permitted items; scroll/filter all pages

Expected: All relevant items are reachable without duplicates, skipped entries or false totals

Status: NOT_RUN

### KAT-BUCKET-008 · P0 · Private Bucket access

Actions: B/C request A's private Bucket by API and direct route

Expected: Visibility follows owner/private access rules; task visibility does not grant Bucket visibility

Status: NOT_RUN

### KAT-BUCKET-009 · P1 · Delete/archive organization contract

Actions: Remove a disposable Bucket using supported action

Expected: Underlying Things are retained unless approved policy says otherwise; D04 defines recovery

Status: NOT_RUN · Product decisions: D04

### KAT-BUCKET-010 · P1 · Bucket association write failure

Actions: Fail Add/Remove after optimistic UI update

Expected: Association rolls back consistently; progress and item lists agree

Status: NOT_RUN

## NOTE — Bucket notes and rich-text editing

Shared prerequisites: A private Bucket note; text/image/file fixtures; empty note

Suggested layers: browser + integration

Candidate source/tests: `scripts/bucket-note-editor-live-mutation.test.mjs`

### KAT-NOTE-001 · P1 · Create and edit note

Actions: Add QA-[run]-note; enter paragraphs; save; refresh

Expected: Note content and formatting persist in the correct Bucket

Status: NOT_RUN

### KAT-NOTE-002 · P1 · Autosave delay and indication

Actions: Type continuously; pause; observe save indicator; reload after confirmed save

Expected: Saved indicator corresponds to committed content, not merely local typing

Status: NOT_RUN

### KAT-NOTE-003 · P1 · Failed note save

Actions: Fail save while typing; restore network and retry

Expected: Draft remains and failure is clear; newest text is not overwritten by older saved text

Status: NOT_RUN

### KAT-NOTE-004 · P1 · Rapid note selection

Actions: Edit N1 then select N2 before N1 save returns

Expected: N1 completion cannot replace N2 or write N1 text into N2

Status: NOT_RUN

### KAT-NOTE-005 · P1 · Rich-text and links

Actions: Use supported formatting, links, Unicode and pasted multiline content

Expected: Allowed formatting survives; links are safe and text remains readable

Status: NOT_RUN

### KAT-NOTE-006 · P1 · Note attachment lifecycle

Actions: Attach, remove and download supported note files

Expected: File associations, sizes, access and cleanup reflect the actual note state

Status: NOT_RUN

### KAT-NOTE-007 · P0 · Note authorization

Actions: B/C access A's private note or attachment via guessed IDs

Expected: Backend denies private access and unauthorized writes

Status: NOT_RUN

### KAT-NOTE-008 · P1 · Two-device note edit

Actions: Edit the same note concurrently on two A sessions

Expected: Approved conflict policy applies and prevents silent loss; D11 is required

Status: NOT_RUN · Product decisions: D11

### KAT-NOTE-009 · P1 · Navigation before save

Actions: Leave a dirty note or close the tab during a pending save

Expected: Approved save/unsaved warning behavior is explicit; no false committed state is shown

Status: NOT_RUN

### KAT-NOTE-010 · P2 · Large note and editor resize

Actions: Open a long note with many blocks on mobile and desktop

Expected: Editor remains responsive; scroll and all controls stay reachable

Status: NOT_RUN

## GCONTACT — Google Contacts sync and discovery

Shared prerequisites: A/B own separate disposable Google address books; configured OAuth and applied migration

Suggested layers: browser + API + DB

Candidate source/tests: `scripts/google-contacts*.test.mjs`

### KAT-GCONTACT-001 · P1 · Sync and match saved phone

Actions: Save B's registered phone in A's Google test contacts; A explicitly syncs

Expected: B appears in A's discovery and unrelated registered users do not

Status: NOT_RUN

### KAT-GCONTACT-002 · P1 · Email and phone normalization

Actions: Use uppercase email, spaces in Indian number and canonical international number

Expected: Exact supported identities match once; no name-only or fuzzy match creates a contact

Status: NOT_RUN

### KAT-GCONTACT-003 · P0 · Private suggestions across accounts

Actions: Sync different Google contact sets in A and B; switch sessions and inspect both

Expected: Each account sees only its own matched snapshot and sync metadata

Status: NOT_RUN

### KAT-GCONTACT-004 · P0 · Forged match import

Actions: Submit a forged contact array, another owner ID or arbitrary registered profile ID to sync API

Expected: Server accepts only its own Google-fetched snapshot for the verified session owner

Status: NOT_RUN

### KAT-GCONTACT-005 · P1 · OAuth cancel or deny

Actions: Close Google popup or deny Contacts permission

Expected: No contact snapshot is replaced; clear cancellation/denial state appears

Status: NOT_RUN

### KAT-GCONTACT-006 · P1 · Multiple contact pages

Actions: Sync address book with more than 1000 contacts and repeated identifiers

Expected: All pages are read within limits; matches are deduplicated and counts are consistent

Status: NOT_RUN

### KAT-GCONTACT-007 · P1 · Mid-sync provider failure

Actions: Fail a later Google page after earlier pages succeeded

Expected: Previous saved matches remain intact; no partial replacement or false success occurs

Status: NOT_RUN

### KAT-GCONTACT-008 · P1 · Contact removal and re-sync

Actions: Remove B from Google contacts; sync again after accepted connection exists

Expected: Discovery match is removed while existing accepted Katalist connection is retained

Status: NOT_RUN

### KAT-GCONTACT-009 · P0 · OAuth callback after account switch

Actions: Begin A's popup; switch Katalist to B before callback completes

Expected: A's callback cannot import into B; no late state or notification appears in B

Status: NOT_RUN

### KAT-GCONTACT-010 · P1 · Unavailable configuration and ambiguous matches

Actions: Disable configuration; then test one Google contact matching multiple profiles

Expected: Configuration failure is explicit; ambiguous contact is excluded instead of choosing a wrong person

Status: NOT_RUN

## CONNECTION — Contact requests and invitations

Shared prerequisites: A/B known permitted contacts; C unrelated; incoming/outgoing request fixtures

Suggested layers: browser + API + DB

Candidate source/tests: `src/features/hub/use-contacts.ts`

### KAT-CONNECTION-001 · P1 · A requests and B accepts

Actions: A sends B an explicit connection request; B accepts; refresh both

Expected: One accepted connection appears at both ends with correct names and counts

Status: NOT_RUN

### KAT-CONNECTION-002 · P1 · B declines request

Actions: A requests B; B declines; inspect both accounts

Expected: Pending state is cleared according to contract; neither shows a false accepted contact

Status: NOT_RUN

### KAT-CONNECTION-003 · P1 · Cancel pending request

Actions: A withdraws outgoing request before B accepts

Expected: Request is no longer actionable; B cannot accept a withdrawn stale request

Status: NOT_RUN

### KAT-CONNECTION-004 · P0 · Unrelated registered user blocked

Actions: A sends a direct request to C who is not in synced Google matches

Expected: Database rejects discovery-bypassing request even if the UUID is known

Status: NOT_RUN

### KAT-CONNECTION-005 · P1 · Reciprocal requests

Actions: A and B request each other close together

Expected: Approved reciprocal auto-accept behavior produces one coherent connection without duplicates

Status: NOT_RUN

### KAT-CONNECTION-006 · P1 · Accepted contact after re-sync

Actions: Remove Google match but keep an accepted connection; open Contacts

Expected: Accepted contact remains accessible and is not silently deleted

Status: NOT_RUN

### KAT-CONNECTION-007 · P0 · Request response authorization

Actions: C responds to A-to-B request by guessed request ID

Expected: Only the intended addressee can accept/decline; request cannot be hijacked

Status: NOT_RUN

### KAT-CONNECTION-008 · P1 · Invite link creation and consumption

Actions: Create a disposable invitation; copy link; redeem with intended test identity

Expected: Invitation lifecycle follows approved recipient rules; role/access are not inferred from arbitrary link text

Status: NOT_RUN

### KAT-CONNECTION-009 · P0 · Invite expired/revoked/wrong recipient

Actions: Redeem revoked, expired and wrong-recipient invitations

Expected: Access is denied with clear safe state; sensitive inviter/resource metadata is not unnecessarily exposed

Status: NOT_RUN

### KAT-CONNECTION-010 · P1 · Invitation failure and clipboard error

Actions: Fail create invitation and separately deny clipboard write

Expected: Creation failure is reported; clipboard failure cannot falsely say the link was copied

Status: NOT_RUN

## CHAT — Direct and group conversations

Shared prerequisites: A/B accepted contacts; permitted group G; Work/Home fixtures

Suggested layers: browser + API + DB

Candidate source/tests: `tests/e2e/preview/thing-references.spec.ts`

### KAT-CHAT-001 · P1 · Create/reuse direct conversation

Actions: Open Message to B twice from A's contacts; inspect B

Expected: One appropriate DM exists per approved context rules; participants are correct

Status: NOT_RUN

### KAT-CHAT-002 · P1 · Send and receive text

Actions: A sends QA-[run]-chat; B replies; reload both

Expected: Each message persists once with the correct sender, order and context

Status: NOT_RUN

### KAT-CHAT-003 · P1 · Empty message validation

Actions: Send blank and whitespace-only text with no files/references

Expected: No empty message is created; meaningful file/reference-only sends follow approved contract

Status: NOT_RUN

### KAT-CHAT-004 · P1 · Message send failure

Actions: Fail A's send; restore network; retry

Expected: Draft stays available; exactly one intended stored message remains after retry

Status: NOT_RUN

### KAT-CHAT-005 · P1 · Create group with selected users

Actions: Create QA-[run]-G with permitted A/B members; inspect roster

Expected: Only selected authorized members appear; unrelated global users are not accidentally added

Status: NOT_RUN

### KAT-CHAT-006 · P1 · Group membership change

Actions: Change supported group membership while B has conversation open

Expected: Roster, visibility and sending rights refresh according to the approved group-role contract

Status: NOT_RUN

### KAT-CHAT-007 · P0 · Outsider reads/sends DM or group

Actions: C guesses conversation ID and message endpoint

Expected: Server denies unauthorized reads, writes and attachment signing

Status: NOT_RUN

### KAT-CHAT-008 · P1 · Long conversation pagination

Actions: Seed several message pages; load older history while new messages arrive

Expected: Ordering, dedupe and scroll anchors remain correct

Status: NOT_RUN

### KAT-CHAT-009 · P1 · Attachments and references in chat

Actions: Send one file and one permitted Thing reference; B opens both

Expected: Message associations persist; viewers recheck resource access independently

Status: NOT_RUN

### KAT-CHAT-010 · P2 · Safe text and failed link preview

Actions: Send HTML-looking text, long URL and emoji; fail link preview

Expected: Text remains safe; message is usable even when preview service fails

Status: NOT_RUN

## READ — Unread counts and reading behavior

Shared prerequisites: A/B chat and Thing comments; multiple A tabs

Suggested layers: browser + integration

Candidate source/tests: `scripts/chat-read-state-cross-tab.test.mjs`

### KAT-READ-001 · P1 · Unread incoming message

Actions: B sends while A's conversation is closed

Expected: A's correct conversation unread count increases; unrelated counts do not

Status: NOT_RUN

### KAT-READ-002 · P1 · Reading active visible thread

Actions: A opens and views the incoming message

Expected: Read marker and badges update consistently for the correct thread

Status: NOT_RUN

### KAT-READ-003 · P1 · Hidden/background thread

Actions: Keep A's tab hidden or another thread selected while B sends

Expected: Unseen content is not automatically marked read merely because a component is mounted

Status: NOT_RUN

### KAT-READ-004 · P1 · Unread comment vs chat count

Actions: B comments on a Thing and sends a DM separately

Expected: Counts target the correct Thing/conversation and do not overwrite one another

Status: NOT_RUN

### KAT-READ-005 · P1 · New messages while scrolled up

Actions: A reads older history; B sends several new messages

Expected: New-message indicator appears; scroll is not forcibly moved away from older content

Status: NOT_RUN

### KAT-READ-006 · P1 · Scroll-to-latest affordance

Actions: Use the new-message indicator to reach the latest message

Expected: Correct messages are reached and read markers advance only as intended

Status: NOT_RUN

### KAT-READ-007 · P0 · Cross-tab read synchronization

Actions: Read in A tab 1; inspect A tab 2 and B

Expected: Same-account read state converges without changing B's personal read state

Status: NOT_RUN

### KAT-READ-008 · P0 · Cross-account read isolation

Actions: Read a thread as A; switch to B on the same browser

Expected: A's cursor/count cannot be reused for B

Status: NOT_RUN

### KAT-READ-009 · P1 · Read/count endpoint failure

Actions: Fail unread/mention count or mark-read request

Expected: Unavailable is shown as unavailable, not zero; failed read acknowledgment is not falsely confirmed

Status: NOT_RUN

### KAT-READ-010 · P1 · Message deletion/history gaps

Actions: Use supported deleted-message fixture between cursor boundaries

Expected: Pagination/read cursors do not skip unrelated unread content or count inaccessible history

Status: NOT_RUN

## CALL — Two-account call basics

Shared prerequisites: A/B; approved mic permission; disposable DM/List; real audio-capable browsers

Suggested layers: browser + device

Candidate source/tests: `src/features/calls/use-list-call.ts`

### KAT-CALL-001 · P1 · A rings and B answers

Actions: A starts call to B; B answers on second device

Expected: Both join the intended room and hear bidirectional audio; UI alone is insufficient proof

Status: NOT_RUN

### KAT-CALL-002 · P1 · B rings and A answers

Actions: Reverse caller/callee and repeat

Expected: Call setup and audio work from both ends, not just the original caller

Status: NOT_RUN

### KAT-CALL-003 · P1 · Decline incoming call

Actions: A rings B; B declines

Expected: A sees a clear declined/end state; neither is left in an active room

Status: NOT_RUN

### KAT-CALL-004 · P1 · Cancel before answer

Actions: A starts ringing then cancels before B answers

Expected: B's stale ring is cleared; late answer cannot resurrect a cancelled room

Status: NOT_RUN

### KAT-CALL-005 · P1 · Mute and unmute

Actions: During connected call mute A then B; unmute each

Expected: Actual audio and displayed mute state agree at both ends

Status: NOT_RUN

### KAT-CALL-006 · P1 · Leave and end semantics

Actions: One participant leaves; remaining participant observes; end call if supported

Expected: Tracks/room membership and displayed call status follow approved caller/room policy

Status: NOT_RUN

### KAT-CALL-007 · P1 · List call participant roster

Actions: Join a permitted List call with A/B; inspect names and avatars

Expected: Correct participant identities appear without actor/profile confusion

Status: NOT_RUN

### KAT-CALL-008 · P0 · Outsider call admission

Actions: C requests ring/join token for private room or List

Expected: Server checks access before issuing room credentials or revealing participants

Status: NOT_RUN

### KAT-CALL-009 · P1 · Navigation while in call

Actions: Switch permitted tabs/routes during an active call

Expected: Approved call continuity policy holds; duplicate joins/tracks are not created

Status: NOT_RUN

### KAT-CALL-010 · P2 · Call keyboard and touch controls

Actions: Operate Answer, Decline, Mute and Leave with keyboard and mobile touch

Expected: Controls are labelled, focused and sufficiently reachable; destructive confusion is avoided

Status: NOT_RUN

## CALLFAIL — Call permission and recovery failures

Shared prerequisites: A/B; test device network/media controls; active and ringing call fixtures

Suggested layers: browser + device

Candidate source/tests: `scripts/list-call-panel-recovery-states.test.mjs`

### KAT-CALLFAIL-001 · P1 · Microphone permission denied

Actions: Deny microphone permission when joining

Expected: Explicit recoverable permission state appears; no phantom connected call is claimed

Status: NOT_RUN

### KAT-CALLFAIL-002 · P1 · No microphone device

Actions: Join on a device with no usable audio input

Expected: User receives an accurate explanation and supported recovery options

Status: NOT_RUN

### KAT-CALLFAIL-003 · P1 · Network drop and reconnect

Actions: Drop A's network during connected call; restore it

Expected: Reconnecting state and real media recovery agree; no duplicate participants appear

Status: NOT_RUN

### KAT-CALLFAIL-004 · P1 · Server room join failure

Actions: Fail room credential/join request

Expected: UI returns to a retryable state; other app features remain usable

Status: NOT_RUN

### KAT-CALLFAIL-005 · P1 · Leave during join race

Actions: Start delayed join then immediately Leave or navigate away

Expected: Late join is disposed; no microphone track or room remains silently active

Status: NOT_RUN

### KAT-CALLFAIL-006 · P1 · Account switch during call

Actions: Switch from A to B while A's call is active

Expected: A-owned room resources and subscriptions are torn down; B cannot inherit A's session

Status: NOT_RUN

### KAT-CALLFAIL-007 · P1 · Membership revoked during call

Actions: Remove B's private List access during call

Expected: Approved admission/revocation policy is enforced; D12 specifies active-room revocation timing

Status: NOT_RUN · Product decisions: D12

### KAT-CALLFAIL-008 · P1 · Repeated ringing deliveries

Actions: Deliver duplicated ring event or receive several simultaneous calls

Expected: Ring UI/notification dedupe and busy handling are coherent; no stacked uncontrolled audio

Status: NOT_RUN

### KAT-CALLFAIL-009 · P2 · Background ringtone and vibration

Actions: Receive ring in background and foreground on supported devices

Expected: Ringtone/vibration follow permission/platform policy; stop reliably when call ends

Status: NOT_RUN

### KAT-CALLFAIL-010 · P1 · Close browser/device sleep

Actions: Sleep B's device or close its tab during a call; reopen

Expected: Presence and room cleanup converge; stale call status does not persist indefinitely

Status: NOT_RUN

## NOTIFY — In-app and push notifications

Shared prerequisites: A/B; browser permission allowed/denied/default; disposable events

Suggested layers: browser + API + device

Candidate source/tests: `scripts/notification-model.test.mjs`

### KAT-NOTIFY-001 · P1 · Task assignment notification

Actions: A assigns B a task; inspect B notification list and open it

Expected: Correct recipient and exact Thing link are used; event appears once

Status: NOT_RUN

### KAT-NOTIFY-002 · P1 · Mention notification

Actions: A mentions B in permitted Thing or chat

Expected: B gets the intended notification with a correct authorized destination

Status: NOT_RUN

### KAT-NOTIFY-003 · P1 · Mark notification read

Actions: B reads one notification then marks all supported entries read

Expected: Unread counts match authoritative per-user state after refresh

Status: NOT_RUN

### KAT-NOTIFY-004 · P0 · Notification ownership

Actions: A attempts to read or mark B's notification IDs through API

Expected: Backend enforces recipient ownership

Status: NOT_RUN

### KAT-NOTIFY-005 · P1 · Deleted or revoked target

Actions: Open a notification whose Thing/List is deleted or access revoked

Expected: Safe unavailable state appears without leaking private content

Status: NOT_RUN

### KAT-NOTIFY-006 · P1 · Push permission defaults

Actions: Sign in with notification permission unset; navigate normally

Expected: Application does not prompt unsolicited permission; supported explicit enable flow remains discoverable

Status: NOT_RUN

### KAT-NOTIFY-007 · P1 · Push allowed and denied

Actions: Explicitly enable on a test browser; deny on another; send test event

Expected: Actual push delivery is verified when allowed; denied permission does not break in-app notifications

Status: NOT_RUN

### KAT-NOTIFY-008 · P1 · Expired device token

Actions: Use expired/stale registration fixture and send notification

Expected: Provider failure is handled; stored task/comment is not rolled back or resent as a duplicate

Status: NOT_RUN

### KAT-NOTIFY-009 · P0 · Push registration account switch

Actions: Register as A; switch to B on same browser; deliver A event

Expected: A's private event is not delivered under B's identity/device association

Status: NOT_RUN

### KAT-NOTIFY-010 · P1 · Duplicate provider/event delivery

Actions: Replay the same notification trigger and refresh B

Expected: Logical dedupe follows contract; count and visible feed do not multiply silently

Status: NOT_RUN

## NUDGE — Nudges and escalation

Shared prerequisites: A owner/B assignee; active, waiting, overdue and terminal fixtures

Suggested layers: browser + API + DB

Candidate source/tests: `scripts/nudge-escalation.test.mjs`

### KAT-NUDGE-001 · P1 · Owner nudges assignee

Actions: A nudges active task assigned to B

Expected: B receives correct task-linked nudge; A sees appropriate history/confirmation

Status: NOT_RUN

### KAT-NUDGE-002 · P0 · Unauthorized nudge

Actions: B assignee and C outsider attempt owner-only nudge

Expected: Backend denies unauthorized mutation and delivery

Status: NOT_RUN

### KAT-NUDGE-003 · P1 · Terminal task nudge guard

Actions: Attempt nudge for sorted/cancelled task

Expected: Terminal guard prevents inappropriate new active-work nudges

Status: NOT_RUN

### KAT-NUDGE-004 · P1 · Nudge filtering

Actions: Filter nudges by List, context, sender and active state where supported

Expected: Results/counts honor selected scope and actual permissions

Status: NOT_RUN

### KAT-NUDGE-005 · P1 · Repeated nudge boundary

Actions: Send repeated nudges within configured cooldown

Expected: Documented rate/cooldown rule is applied consistently; D13 fixes any undefined threshold

Status: NOT_RUN · Product decisions: D13

### KAT-NUDGE-006 · P1 · Escalation job timing

Actions: Freeze clock around configured escalation boundary and execute isolated job

Expected: Only eligible active tasks escalate; time-window rule is deterministic

Status: NOT_RUN

### KAT-NUDGE-007 · P1 · Job idempotency

Actions: Run same maintenance/escalation window twice

Expected: No duplicate logical escalation or duplicate state transition occurs

Status: NOT_RUN

### KAT-NUDGE-008 · P0 · Job authentication

Actions: Call job route without valid cron/service credentials

Expected: Request is rejected before scanning private work or sending events

Status: NOT_RUN

### KAT-NUDGE-009 · P1 · Nudge delivery failure

Actions: Store nudge while notification transport fails

Expected: Persistent nudge state is coherent; transport failure is not mistaken for successful delivery

Status: NOT_RUN

### KAT-NUDGE-010 · P1 · Large nudge history

Actions: Seed older and new history beyond default loaded window

Expected: History/window indicators are honest; unqueried older records are not claimed absent

Status: NOT_RUN

## BRIEF — Morning Brief and Catch Up

Shared prerequisites: A/B separate due tasks/nudges; Work/Home; controlled local date

Suggested layers: browser + API + DB

Candidate source/tests: `scripts/morning-brief-receipts-sql.test.mjs`

### KAT-BRIEF-001 · P1 · Correct daily greeting/content

Actions: Open brief at approved local morning boundary with known due items

Expected: Greeting/date and actionable items match the active account and context

Status: NOT_RUN

### KAT-BRIEF-002 · P1 · Manual reopen

Actions: Dismiss brief; use supported manual reopen control

Expected: Current brief opens again without inventing an automatic daily claim

Status: NOT_RUN

### KAT-BRIEF-003 · P1 · Automatic-open feature gate

Actions: Test automatic-open flag off and on with configured receipts schema

Expected: Off prevents automatic opening; on uses the actual supported scheduling/claim logic

Status: NOT_RUN

### KAT-BRIEF-004 · P1 · Same-account two-device daily claim

Actions: A opens app concurrently on two devices during daily window

Expected: Receipt/claim policy avoids duplicate automatic opening according to approved contract

Status: NOT_RUN

### KAT-BRIEF-005 · P0 · Claim account isolation

Actions: A claims/open brief; B signs in on same device

Expected: B's daily eligibility and content are independent of A's claim

Status: NOT_RUN

### KAT-BRIEF-006 · P1 · Context-specific brief

Actions: Different Work/Home due items; switch context

Expected: Brief and Catch Up show items for the correct context

Status: NOT_RUN

### KAT-BRIEF-007 · P1 · Empty brief vs fetch failure

Actions: Test genuinely no actionable items and separately failed brief reads

Expected: Empty and error states are distinguishable; failure never pretends the day is clear

Status: NOT_RUN

### KAT-BRIEF-008 · P1 · Catch Up opens exact Thing

Actions: Select each due/nudge/unread card and navigate

Expected: Exact permitted task opens; no wrong task from stale card index

Status: NOT_RUN

### KAT-BRIEF-009 · P1 · Timers and midnight reset

Actions: Advance clock through brief window and next local day; hide/show app

Expected: Timers do not duplicate callbacks; receipt/date rolls over correctly

Status: NOT_RUN

### KAT-BRIEF-010 · P2 · Reduced-motion and animation lifecycle

Actions: Enable reduced motion; open/dismiss brief rapidly and navigate

Expected: Content remains available; stale transitions do not trap focus or render duplicate overlays

Status: NOT_RUN

## PROFILE — Me page and preferences

Shared prerequisites: A/B; profile/avatar and preference fixtures; private stats

Suggested layers: browser + API

Candidate source/tests: `scripts/me-preferences-and-avatar.test.mjs`

### KAT-PROFILE-001 · P1 · Correct signed-in identity

Actions: Sign in A then B; open Me and top navigation

Expected: Name/avatar correspond to the active account; unknown data does not fabricate another user's identity

Status: NOT_RUN

### KAT-PROFILE-002 · P1 · Profile edit persistence

Actions: Edit supported display name/occupation/preferences; save and reload

Expected: Only permitted fields update; all profile surfaces converge

Status: NOT_RUN

### KAT-PROFILE-003 · P1 · Profile save error

Actions: Fail profile mutation after editing

Expected: Draft remains recoverable; visible success is not shown before a committed save

Status: NOT_RUN

### KAT-PROFILE-004 · P1 · Avatar upload and remove

Actions: Upload supported avatar; refresh; replace/remove if supported

Expected: Correct avatar and storage references appear; old local previews do not persist

Status: NOT_RUN

### KAT-PROFILE-005 · P0 · Profile write ownership

Actions: A submits update payload targeting B's profile

Expected: Server/RLS prevents editing B's profile or protected role fields

Status: NOT_RUN

### KAT-PROFILE-006 · P1 · Preference account isolation

Actions: Set different supported preferences for A and B; switch accounts

Expected: A's preferences do not carry into B's UI

Status: NOT_RUN

### KAT-PROFILE-007 · P1 · Stats full dataset accuracy

Actions: Seed many completed/active Things across pages; inspect Me totals

Expected: Stats are authoritative and correctly scoped, not derived from a partial current page

Status: NOT_RUN

### KAT-PROFILE-008 · P1 · Stats unavailable state

Actions: Fail personal statistics requests

Expected: Unavailable data is explicit rather than displayed as a trustworthy zero

Status: NOT_RUN

### KAT-PROFILE-009 · P2 · Name and avatar edge cases

Actions: Use long/Unicode name, no avatar and broken avatar URL

Expected: Fallback is safe and consistent; real identities with same names stay distinct

Status: NOT_RUN

### KAT-PROFILE-010 · P1 · Device/session controls

Actions: Use supported session/device management on disposable sessions

Expected: Only intended session is affected; self-lockout and device-limit behavior are clear

Status: NOT_RUN

## ARCHIVE — Sorted, cancelled and personal hiding recovery

Shared prerequisites: A owner/B assignee; sorted/cancelled and hidden fixtures

Suggested layers: browser + API + DB

Candidate source/tests: `scripts/trophy-read-state.test.mjs`

### KAT-ARCHIVE-001 · P1 · Find sorted Thing

Actions: B sorts test Thing; use completed/Trophy/history entry in A and B

Expected: Sorted item is discoverable through the actual authorized history path and not silently lost

Status: NOT_RUN

### KAT-ARCHIVE-002 · P1 · Sorted detail integrity

Actions: Open sorted task from history; inspect comments/files/activity

Expected: Stored detail remains readable where authorized; terminal controls do not imply active work

Status: NOT_RUN

### KAT-ARCHIVE-003 · P1 · Search completed data

Actions: Search for exact test prefix in completed/history views

Expected: Supported history search locates the intended authorized task beyond current preview cards

Status: NOT_RUN

### KAT-ARCHIVE-004 · P1 · Cancelled task recovery

Actions: A cancels then uses owner Reopen

Expected: Cancelled task returns according to current server contract and both ends update

Status: NOT_RUN

### KAT-ARCHIVE-005 · P1 · Sorted restoration requirement

Actions: Attempt to restore a sorted task using supported UI

Expected: D04 must define whether sorted restoration exists; current cancelled-only reopen cannot be silently treated as sorted restoration

Status: NOT_RUN · Product decisions: D04

### KAT-ARCHIVE-006 · P0 · Terminal mutation prohibition

Actions: Try ordinary assignment, due, pace and workflow changes on terminal fixture

Expected: Terminal state guards hold in UI and backend unless an explicitly permitted restore occurs

Status: NOT_RUN

### KAT-ARCHIVE-007 · P1 · Shred/personal hide semantics

Actions: Use Shred/hide on a disposable fixture; inspect other authorized account

Expected: D06 defines recovery and whether this is personal hiding; no accidental global deletion is acceptable

Status: NOT_RUN · Product decisions: D06

### KAT-ARCHIVE-008 · P1 · History counters and pagination

Actions: Seed many sorted/cancelled tasks; view all pages and counts

Expected: Completed statistics, paging and task sets agree

Status: NOT_RUN

### KAT-ARCHIVE-009 · P0 · Private completed-task access

Actions: C guesses completed task ID and asks detail/file endpoints

Expected: Completion does not make private tasks public

Status: NOT_RUN

### KAT-ARCHIVE-010 · P1 · History mutation failure

Actions: Fail a supported reopen/hide action after optimistic UI

Expected: Original state is restored; task is not lost between active and history views

Status: NOT_RUN

## REF — Thing references and permalinks

Shared prerequisites: A/B permitted Thing T; private C Thing; MAX_THING_REFERENCES=10

Suggested layers: unit + browser + DB

Candidate source/tests: `scripts/thing-reference.test.mjs`

### KAT-REF-001 · P1 · Copy and open permalink

Actions: Copy T's Thing link; open it as permitted B after reload

Expected: Exact durable Thing ID opens; title changes do not invalidate reference

Status: NOT_RUN

### KAT-REF-002 · P1 · Paste reference into capture

Actions: Paste supported Thing permalink into Magic Box; create a referencing task

Expected: Stored reference points to T without cloning it or granting extra access

Status: NOT_RUN

### KAT-REF-003 · P1 · Reference in comment and chat

Actions: Send supported reference in each composer; B opens card

Expected: Correct current authorized metadata is read and link opens exact T

Status: NOT_RUN

### KAT-REF-004 · P1 · Duplicate references

Actions: Paste same Thing twice with UUID case variations

Expected: Supported dedupe keeps one reference per canonical Thing ID

Status: NOT_RUN

### KAT-REF-005 · P1 · Reference count boundary

Actions: Add 10 unique references then an 11th

Expected: Configured maximum is enforced with clear feedback; existing valid references remain

Status: NOT_RUN

### KAT-REF-006 · P1 · Malformed/version/foreign-origin reference

Actions: Paste malformed UUID, unsupported version and lookalike foreign URL

Expected: Invalid representations are rejected and unrelated external URL remains ordinary text

Status: NOT_RUN

### KAT-REF-007 · P0 · Reference grants no access

Actions: A sends C a reference to a task C cannot view

Expected: C sees safe unavailable state; title/files/participants do not leak through card metadata

Status: NOT_RUN

### KAT-REF-008 · P1 · Revoked reference target

Actions: Remove B's access after a reference card was cached

Expected: Cached preview is retired; opening/re-signing checks current access

Status: NOT_RUN

### KAT-REF-009 · P1 · Destination routing race

Actions: Queue reference while navigation to Court/List capture is pending

Expected: Exactly the intended visible composer consumes it once, in the correct context

Status: NOT_RUN

### KAT-REF-010 · P1 · Reference-only submission contract

Actions: Submit a draft with references but no typed title/text

Expected: Approved composer-specific policy applies; unsupported input is explicit under D14

Status: NOT_RUN · Product decisions: D14

## DESIGN — Design library and covers

Shared prerequisites: Configured List/design schema; A owner/B collaborator/V view-only

Suggested layers: browser + API + DB

Candidate source/tests: `scripts/design-resources-sql.test.mjs`

### KAT-DESIGN-001 · P1 · Create design record

Actions: Save a supported Figma/design link in a permitted List folder

Expected: One design record persists with correct List, folder, URL and author

Status: NOT_RUN

### KAT-DESIGN-002 · P1 · Figma URL validation

Actions: Use valid file/design URL, malformed URL and deceptive host

Expected: Supported URLs are accepted; unsafe/malformed hosts rejected without breaking ordinary data

Status: NOT_RUN

### KAT-DESIGN-003 · P1 · Rename/move folders and designs

Actions: Use permitted edit/move actions; refresh another account

Expected: Hierarchy, displayed name and linked record remain coherent

Status: NOT_RUN

### KAT-DESIGN-004 · P1 · Cover size/content checks

Actions: Upload supported cover at 5 MiB limit and invalid/over-limit bytes

Expected: Approved content and size are enforced; clear fallback retains design usability

Status: NOT_RUN

### KAT-DESIGN-005 · P1 · Cover signing failure

Actions: Fail signed cover URL; retry/view design

Expected: Unavailable cover is explicit; no fabricated image/URL masks the error

Status: NOT_RUN

### KAT-DESIGN-006 · P0 · List role enforcement

Actions: V/C attempt design/folder mutations; B reads or edits where allowed

Expected: Server enforces actual role contract, not merely button visibility

Status: NOT_RUN

### KAT-DESIGN-007 · P1 · Link design to Thing

Actions: Link one design to a permitted Thing; inspect both directions

Expected: Association persists without duplicating design or granting additional Thing access

Status: NOT_RUN

### KAT-DESIGN-008 · P1 · Large design grid and paging

Actions: Seed many folders/designs; search and paginate

Expected: All relevant records are reachable; filtering and counts do not use only a partial page

Status: NOT_RUN

### KAT-DESIGN-009 · P1 · Offline mutation and retry

Actions: Edit design while offline or provider unavailable; retry

Expected: Draft/error state is clear; successful retry produces one coherent update

Status: NOT_RUN

### KAT-DESIGN-010 · P0 · Removed List member views design

Actions: Remove B's List access while viewer is open

Expected: Private record, cover signing and linked metadata follow current permissions

Status: NOT_RUN

## CODE — Code Activity and Coey optional workflow

Shared prerequisites: Feature-gated deployment; disposable GitHub repository; A owner/B collaborator/V view-only

Suggested layers: integration + browser + API

Candidate source/tests: `scripts/code-activity-*.test.mjs`

### KAT-CODE-001 · P0 · Production and configuration gate

Actions: Open optional tab/API with feature off or provider unconfigured

Expected: Correct unavailable/disabled state appears; gate does not expose mock activity as real

Status: NOT_RUN

### KAT-CODE-002 · P0 · Repository connection permissions

Actions: A connects one approved repository; B/V/C attempt connection changes

Expected: Only owner manages connection; tokens remain server-side and scoped to the repository

Status: NOT_RUN

### KAT-CODE-003 · P1 · Read commits/PR/checks/diffs

Actions: Create known fixture commits/PRs in disposable repo; refresh feed

Expected: Real provider data matches repo; unavailable checks are not displayed as passed or zero

Status: NOT_RUN

### KAT-CODE-004 · P1 · Pagination/filter and provider limit

Actions: Load multiple activity pages; filter; simulate 403/429/provider outage

Expected: Ordering/dedupe are correct; rate/error state is honest and feature-local

Status: NOT_RUN

### KAT-CODE-005 · P0 · Webhook signature and replay

Actions: Send valid signed fixture, invalid signature and same delivery twice

Expected: Invalid intake is rejected; valid replay is deduplicated without duplicate Things

Status: NOT_RUN

### KAT-CODE-006 · P0 · Private AI consent

Actions: Use Coey before consent, after owner consent and after consent removal

Expected: Private repository content is sent only when all approved AI gates/consent allow it

Status: NOT_RUN

### KAT-CODE-007 · P0 · No automatic task creation

Actions: Receive webhook or generate AI draft without confirming

Expected: No Thing is created until an authorized person explicitly confirms

Status: NOT_RUN

### KAT-CODE-008 · P1 · Confirm draft once

Actions: A/B authorized collaborator confirms a reviewed draft; double-submit

Expected: Intended List Thing is created once with correct source/assignee/attributes

Status: NOT_RUN

### KAT-CODE-009 · P0 · Prompt injection in provider text

Actions: Use malicious-looking commit/PR/diff text that requests secrets or actions

Expected: Provider text is treated as data; no secret disclosure, code execution or permission override occurs

Status: NOT_RUN

### KAT-CODE-010 · P0 · Membership revoked and token protection

Actions: Revoke B's List access; inspect API calls/client bundle/logs

Expected: Unauthorized provider reads/actions fail before token use; secrets never reach client/evidence

Status: NOT_RUN

## QA — Manual QA cases, runs and evidence

Shared prerequisites: QA feature enabled; disposable app/List/test-account fixtures; A owner/B tester/V viewer

Suggested layers: browser + API + DB

Candidate source/tests: `scripts/qa-domain.test.mjs`

### KAT-QA-001 · P1 · Case create/edit/version

Actions: Create test case with title, prerequisites and ordered steps; edit it; create run

Expected: Case versioning and run snapshot preserve what was actually executed

Status: NOT_RUN

### KAT-QA-002 · P1 · Case spreadsheet import/export

Actions: Import provided QA CSV; include multiline steps and escaped formula-like text; export

Expected: Rows preserve content and valid enums; formulas are escaped and not executed in spreadsheets

Status: NOT_RUN

### KAT-QA-003 · P1 · Run assignment and filters

Actions: Create run; assign cases to A/B; filter result/assignee/module

Expected: Assignments, totals and filters reflect authoritative run records

Status: NOT_RUN

### KAT-QA-004 · P1 · Record Pass/Fail/Blocked

Actions: Submit pass, fail with actual result, blocked with reason and N/A

Expected: Fail/blocked require notes; statuses persist and counters update exactly

Status: NOT_RUN

### KAT-QA-005 · P1 · Multiple attempts and history

Actions: Fail a case; retest Pass; inspect attempt history

Expected: Original failure is retained; latest result is accurate without erasing evidence

Status: NOT_RUN

### KAT-QA-006 · P0 · Credential vault role checks

Actions: A configures disposable credential; authorized tester retrieves; V/C attempt read

Expected: Server enforces allowed access; encrypted secret is not shown to unauthorized roles

Status: NOT_RUN

### KAT-QA-007 · P0 · Evidence ownership lifecycle

Actions: Begin/upload/finalize evidence; attempt wrong-run/wrong-owner storage key

Expected: Only authorized evidence is associated; guessed keys cannot leak private media

Status: NOT_RUN

### KAT-QA-008 · P1 · Aborted evidence and cleanup

Actions: Abort upload or fail finalize; run isolated cleanup

Expected: Staged orphan is removed safely without deleting valid finalized evidence

Status: NOT_RUN

### KAT-QA-009 · P1 · Run completion with unfinished cases

Actions: Complete run with Not Run or Blocked remaining

Expected: UI requires explicit acceptance under existing QA domain contract; release gate still forbids unresolved P0/P1

Status: NOT_RUN

### KAT-QA-010 · P0 · Role/access loss during QA action

Actions: Remove B's permissions while run/evidence/secret request is pending

Expected: New operations fail and private cached results retire on identity/access change

Status: NOT_RUN

## BRIDGE — External Bridge access tokens

Shared prerequisites: Disposable valid/expired/revoked/wrong-recipient Bridge grants

Suggested layers: API + DB + browser

Candidate source/tests: `scripts/bridge-authorization-sql.test.mjs`

### KAT-BRIDGE-001 · P1 · Valid intended recipient

Actions: Redeem a valid fixture link as its intended recipient; view allowed Thing

Expected: Grant exposes only its intended task and capabilities, not full app/account access

Status: NOT_RUN

### KAT-BRIDGE-002 · P0 · Malformed and short token

Actions: Open short, empty, malformed and random token paths

Expected: Safe failure state; no task metadata or existence oracle beyond approved response

Status: NOT_RUN

### KAT-BRIDGE-003 · P0 · Expired and revoked grants

Actions: Redeem expired/revoked token; retry formerly valid session

Expected: Access remains denied; stale token/session cannot restore permission

Status: NOT_RUN

### KAT-BRIDGE-004 · P0 · Wrong-recipient session

Actions: Use session from another grant/actor against target Thing

Expected: Recipient/grant binding is enforced server-side

Status: NOT_RUN

### KAT-BRIDGE-005 · P0 · Bridge scope escalation

Actions: Submit different Thing ID, attachment ID or assignee ID with valid grant

Expected: Grant cannot authorize another resource or person

Status: NOT_RUN

### KAT-BRIDGE-006 · P1 · Allowed Bridge status update

Actions: Use permitted active status transition; refresh app as A/B

Expected: Main app and Bridge converge on authoritative state

Status: NOT_RUN

### KAT-BRIDGE-007 · P0 · Forward-only workflow

Actions: Attempt return to not_started after progress via direct Bridge API

Expected: Server rejects unsupported backward status; UI does not offer misleading action

Status: NOT_RUN

### KAT-BRIDGE-008 · P1 · Bridge comment permissions

Actions: Post permitted fixture comment; attempt forged author identity

Expected: Server derives actual author and scope; disallowed comment behavior is blocked

Status: NOT_RUN

### KAT-BRIDGE-009 · P0 · Token leakage prevention

Actions: Inspect redirects, URLs, logs, referrers and evidence while navigating Bridge

Expected: Token is not exposed to unrelated third parties or public reports

Status: NOT_RUN

### KAT-BRIDGE-010 · P1 · Bridge provider/network failure

Actions: Fail redeem/read/action request; retry when restored

Expected: Clear retryable state; failure cannot be interpreted as an accepted action

Status: NOT_RUN

## AUTHZ — Application-wide permission matrix

Shared prerequisites: A owner/B assignee/V view-only/C outsider/X removed member

Suggested layers: API + DB + browser

Candidate source/tests: `scripts/katalist-permissions.test.mjs`

### KAT-AUTHZ-001 · P0 · Anonymous protected endpoints

Actions: Enumerate documented private task/List/chat/file/contact/QA routes; call without auth

Expected: Each requires verified auth before privileged action or private response

Status: NOT_RUN

### KAT-AUTHZ-002 · P0 · Outsider object ID tampering

Actions: As C, substitute A's task/List/Bucket/chat/evidence IDs in reads and writes

Expected: RLS/handler checks deny unrelated resources even if UUIDs are known

Status: NOT_RUN

### KAT-AUTHZ-003 · P0 · Owner versus assignee capability

Actions: Test A owner of B task against every workflow/due/importance/reassignment action

Expected: Per-action role matrix holds in UI, API and database independently

Status: NOT_RUN

### KAT-AUTHZ-004 · P0 · Creator-only actor

Actions: Create fixture where creator is neither owner nor current assignee; attempt workflow changes

Expected: Creator identity alone grants no ownership/assignee workflow capability

Status: NOT_RUN

### KAT-AUTHZ-005 · P0 · View-only API bypass

Actions: As V, directly request mutations hidden/disabled in UI

Expected: Backend rejects prohibited mutation instead of trusting UI state

Status: NOT_RUN

### KAT-AUTHZ-006 · P0 · Removed membership and cached tokens

Actions: Revoke X's membership; reuse existing valid authentication token

Expected: Authentication is not sufficient; current resource authorization is rechecked

Status: NOT_RUN

### KAT-AUTHZ-007 · P0 · Service-role exposure

Actions: Inspect built client artifacts, public environment and logs for privileged keys

Expected: No service-role/provider/vault secret appears in browser artifacts or public configuration

Status: NOT_RUN

### KAT-AUTHZ-008 · P0 · Read-only projection restrictions

Actions: Query public identities/overview endpoints and compare private fields

Expected: Endpoints return only authorized/intended projection; metadata cannot leak full private profile/Thing data

Status: NOT_RUN

### KAT-AUTHZ-009 · P0 · Overposting and owner impersonation

Actions: Submit owner, creator, role, timestamps and recipient fields not permitted for operation

Expected: Server derives trusted fields or rejects unauthorized payload, preserving ownership invariants

Status: NOT_RUN

### KAT-AUTHZ-010 · P0 · Audit and attachment consistency

Actions: Perform permitted/denied mutations; inspect authorized activity and object associations

Expected: Only successful authorized actions persist; failed mutation cannot leave orphan grants/files/activity

Status: NOT_RUN

## IDENTITY — Account switching and realtime isolation

Shared prerequisites: Separate A/B sessions; same-browser switch fixture; delayed requests and drafts

Suggested layers: unit + integration + browser

Candidate source/tests: `scripts/identity-boundary.test.mjs`

### KAT-IDENTITY-001 · P0 · Cached query separation

Actions: Load A Court/List/chat/contacts; sign out and sign in B

Expected: No A records or thumbnails appear under B even briefly

Status: NOT_RUN

### KAT-IDENTITY-002 · P0 · Pending read completion

Actions: Delay A read; switch B; release response

Expected: Late A result is discarded or remains scoped to retired A cache

Status: NOT_RUN

### KAT-IDENTITY-003 · P0 · Pending mutation completion

Actions: Begin A permitted mutation; switch B before response

Expected: Mutation remains attributed to A if committed; B receives no stale UI success/data

Status: NOT_RUN

### KAT-IDENTITY-004 · P0 · Draft separation

Actions: Draft capture, comments, chat and notes as A; switch B

Expected: B cannot see or submit A's drafts; returning A follows documented persistence

Status: NOT_RUN

### KAT-IDENTITY-005 · P0 · Realtime channel teardown

Actions: Subscribe A private channels; switch B; emit A updates

Expected: A channels are unsubscribed; B receives only authorized events

Status: NOT_RUN

### KAT-IDENTITY-006 · P0 · Read cursor separation

Actions: Advance A read markers; switch B with same task/thread IDs visible

Expected: Read state remains per user; A cursor never marks B content read

Status: NOT_RUN

### KAT-IDENTITY-007 · P0 · Provider callback ownership

Actions: Open Google/GitHub callback as A; switch B before completion

Expected: Stale operation cannot link or import under B identity

Status: NOT_RUN

### KAT-IDENTITY-008 · P0 · Cached signed/private media disposal

Actions: Load A private PDF/avatar/evidence; switch B

Expected: Owned Blob URLs, private viewer state and signing authority are retired appropriately

Status: NOT_RUN

### KAT-IDENTITY-009 · P1 · Same-account cross-tab convergence

Actions: A edits state in tab1; tab2 reconnects or receives invalidation

Expected: Both converge without duplicated mutations, discarded valid unread state or infinite refresh loops

Status: NOT_RUN

### KAT-IDENTITY-010 · P0 · Identity pending versus signed out

Actions: Transition auth through loading/pending/null before B resolves

Expected: Old identity is retired immediately; pending is not treated as permission to show previous data

Status: NOT_RUN

## RECOVERY — Network errors, retries and data integrity

Shared prerequisites: A/B; request interceptor; delayed, failed and ambiguous mutation responses

Suggested layers: integration + browser

Candidate source/tests: `scripts/query-updates-rollback.test.mjs`

### KAT-RECOVERY-001 · P1 · Offline read behavior

Actions: Load permitted data; go offline; navigate or refresh

Expected: Cached/offline/unavailable states are truthful; no fabricated empty success

Status: NOT_RUN

### KAT-RECOVERY-002 · P1 · Offline write behavior

Actions: Attempt capture/comment/status while offline

Expected: Unsaved draft survives or supported queue is explicit; no false committed success

Status: NOT_RUN

### KAT-RECOVERY-003 · P1 · Reconnect reconciliation

Actions: Mutate fixtures through B while A offline; reconnect A

Expected: A refetches and converges to actual server state without stale overwrite

Status: NOT_RUN

### KAT-RECOVERY-004 · P1 · Server 500 and 503

Actions: Fail selected task/contact/chat endpoint then retry

Expected: Feature displays useful recoverable error; unrelated features remain functional

Status: NOT_RUN

### KAT-RECOVERY-005 · P1 · 429 and backoff

Actions: Rate-limit read/write/provider request; observe retry behavior

Expected: No unbounded retry storm; UI remains usable and respects approved retry policy

Status: NOT_RUN

### KAT-RECOVERY-006 · P0 · Ambiguous write response

Actions: Commit write server-side then drop response; user retries

Expected: Ambiguity/idempotency contract prevents or detects duplicates and preserves actual committed item

Status: NOT_RUN

### KAT-RECOVERY-007 · P1 · Optimistic update rollback

Actions: Fail an optimistic pace/assignment/bucket change

Expected: All affected surfaces restore consistent prior state

Status: NOT_RUN

### KAT-RECOVERY-008 · P1 · Partial secondary failure

Actions: Commit task/comment but fail statistics/notification/signing follow-up

Expected: Primary write remains truthful; secondary unavailable state cannot encourage duplicate primary write

Status: NOT_RUN

### KAT-RECOVERY-009 · P1 · Timeout and request cancellation

Actions: Hang read; change route/account; inspect cancellation and retry

Expected: Bounded loading; stale response cannot update wrong view; cancellation does not claim data loss

Status: NOT_RUN

### KAT-RECOVERY-010 · P0 · Preview/live adapter boundary

Actions: Run demo mutations with fixture backend unreachable; separately fail real backend

Expected: Preview writes stay local; live failures cannot silently replace real data with demo records

Status: NOT_RUN

## A11Y — Keyboard and assistive access

Shared prerequisites: Core routes and dialogs; automated axe checks plus human keyboard/screen reader

Suggested layers: browser + manual

Candidate source/tests: `tests/e2e/preview/accessibility-cross-cutting.spec.ts`

### KAT-A11Y-001 · P1 · Keyboard-only golden path

Actions: Sign in, capture, assign, Catch, comment and Sort without mouse

Expected: All required controls are reachable/operable in sensible order

Status: NOT_RUN

### KAT-A11Y-002 · P1 · Dialog focus management

Actions: Open/close Thing, contacts, call and file dialogs with keyboard

Expected: Initial focus, focus containment where modal, Escape and return focus work correctly

Status: NOT_RUN

### KAT-A11Y-003 · P1 · Accessible names

Actions: Inspect inputs and icon-only controls across core routes

Expected: Each has an accurate accessible name; duplicate/ambiguous labels are resolved

Status: NOT_RUN

### KAT-A11Y-004 · P1 · Screen-reader status changes

Actions: Trigger loading, error, send success, unread and sync status

Expected: Important changes are announced without repeated noisy announcements

Status: NOT_RUN

### KAT-A11Y-005 · P1 · Color-independent state

Actions: Compare Work/Home, status, priority, unread and QA results without color

Expected: Labels/icons/pressed state convey meaning independent of hue

Status: NOT_RUN

### KAT-A11Y-006 · P1 · Contrast and focus

Actions: Measure approved text/control/focus colors against their actual backgrounds

Expected: Automated/human contrast criteria in approved design baseline are met

Status: NOT_RUN

### KAT-A11Y-007 · P1 · Zoom and text scaling

Actions: Use 200% zoom and supported OS text scaling on core flows

Expected: Content reflows; actions and error messages remain reachable without content loss

Status: NOT_RUN

### KAT-A11Y-008 · P1 · Reduced motion

Actions: Enable reduced-motion preference; open brief, stacks, contacts and animations

Expected: Core functionality remains; decorative motion is reduced and no transition traps input

Status: NOT_RUN

### KAT-A11Y-009 · P2 · Touch target and drag alternative

Actions: Measure small action controls; perform lane/bucket organization without drag

Expected: Targets meet approved minimum; keyboard/touch alternatives preserve functionality

Status: NOT_RUN

### KAT-A11Y-010 · P1 · Error association

Actions: Trigger invalid phone, capture, invite and QA form inputs

Expected: Errors are associated with fields and announced; focus aids correction without discarding input

Status: NOT_RUN

## DEVICE — Responsive and cross-browser behavior

Shared prerequisites: Chromium, Firefox, WebKit; Android Chrome/iOS Safari; viewport matrix

Suggested layers: browser + device

Candidate source/tests: `playwright.config.ts`

### KAT-DEVICE-001 · P1 · Mobile Court golden path

Actions: At 390x844 perform capture, assignment, details, comment and Sort

Expected: Primary controls remain reachable; no horizontal clipping blocks completion

Status: NOT_RUN

### KAT-DEVICE-002 · P1 · Small mobile viewport

Actions: At 320x568 inspect core navigation, dialogs and onscreen keyboard

Expected: Content reflows; action buttons and focused input remain accessible

Status: NOT_RUN

### KAT-DEVICE-003 · P1 · Tablet portrait/landscape

Actions: Repeat List/detail/contact flows at 768x1024 and 1024x768

Expected: Layouts adapt without losing selection, drafts or task controls

Status: NOT_RUN

### KAT-DEVICE-004 · P1 · Desktop and full HD

Actions: Repeat core flows at 1440x900 and 1920x1080

Expected: No unusably narrow panes or oversized empty space; content/details remain readable

Status: NOT_RUN

### KAT-DEVICE-005 · P1 · Real browser engine coverage

Actions: Run the critical suite in Chromium, Firefox and WebKit with independently seeded data

Expected: Supported engines produce equivalent functional outcomes; project registration is verified

Status: NOT_RUN

### KAT-DEVICE-006 · P1 · Orientation during edit

Actions: Rotate phone while drafting comment/capture or viewing file

Expected: Draft and selected resource survive; no duplicate submission or detached overlay

Status: NOT_RUN

### KAT-DEVICE-007 · P1 · Soft keyboard and safe areas

Actions: Focus bottom composer on real iOS/Android; open keyboard and dismiss

Expected: Input and Send remain visible; safe-area bars do not cover actions

Status: NOT_RUN

### KAT-DEVICE-008 · P1 · Touch gestures and scroll

Actions: Scroll long chat/history; swipe/drag supported task cards

Expected: Gesture does not trigger unintended destructive action or block normal scrolling

Status: NOT_RUN

### KAT-DEVICE-009 · P2 · Pointer and hover alternatives

Actions: Operate icon actions on touch device with no hover

Expected: Required information/actions remain discoverable without hover-only affordances

Status: NOT_RUN

### KAT-DEVICE-010 · P1 · PWA/installed versus browser

Actions: If supported, repeat sign-in/notifications/deep links in installed app and browser

Expected: Storage/navigation/push behavior follows platform policy; PWA absence is labelled gated rather than passed

Status: NOT_RUN

## PERF — Large-data performance and lifecycle

Shared prerequisites: Staging datasets 0,1,25,250,2500 records; declared reference hardware/network

Suggested layers: benchmark + browser

Candidate source/tests: `scripts/thing-overview-volume.test.mjs`

### KAT-PERF-001 · P1 · Cold and warm route timing

Actions: Measure login-to-Court and major route navigation on reference device/network

Expected: Record p50/p95 and compare approved D15 budgets; spinner duration is not hidden by preload

Status: NOT_RUN · Product decisions: D15

### KAT-PERF-002 · P1 · Large Court and history

Actions: Seed 2500 mixed tasks; filter/search/view all/load history

Expected: All items remain accessible with bounded reads and accurate totals; approved D15 time budget is met

Status: NOT_RUN · Product decisions: D15

### KAT-PERF-003 · P1 · Large List and Bucket totals

Actions: Seed many associations including duplicate List/Thing paths

Expected: Counts/progress are correct; fetches do not perform unbounded per-item queries

Status: NOT_RUN

### KAT-PERF-004 · P1 · Directory and avatar request dedupe

Actions: Open Court/detail/chat simultaneously with shared identities

Expected: Requests are deduplicated appropriately; missing avatar never triggers uncontrolled retries

Status: NOT_RUN

### KAT-PERF-005 · P1 · Memory after repeated routes

Actions: Navigate/open/close major surfaces 100 cycles; measure memory after collection

Expected: No monotonic retained growth beyond approved D15 threshold; private media resources are released

Status: NOT_RUN · Product decisions: D15

### KAT-PERF-006 · P1 · Subscription listener lifecycle

Actions: Repeatedly enter/leave chats/Lists/calls and switch identities

Expected: One intended active listener/channel per scope; teardown prevents duplicated events

Status: NOT_RUN

### KAT-PERF-007 · P1 · CPU while hidden

Actions: Background app with animations/contacts/brief; inspect active timers/rendering

Expected: Decorative work pauses where designed; no runaway loops or repeated network refresh

Status: NOT_RUN

### KAT-PERF-008 · P1 · Concurrent independent reads

Actions: Load multiple summaries/panels under latency; inspect request waterfall

Expected: Independent requests use bounded concurrency without serial per-row delays or request explosion

Status: NOT_RUN

### KAT-PERF-009 · P1 · Expensive file preview

Actions: Open large valid PDF; rapidly change pages; monitor responsiveness

Expected: UI stays usable; stale render work is cancelled/ignored and approved limits are enforced

Status: NOT_RUN

### KAT-PERF-010 · P1 · Provider and API budgets

Actions: Measure Google sync, Code Activity refresh and background jobs on large fixtures

Expected: Limits/timeouts are explicit; maximum-size inputs complete or fail safely within approved budgets

Status: NOT_RUN

## DEPLOY — Build, migrations and release validation

Shared prerequisites: Candidate commit; isolated staging; migration inventory; approved production operator

Suggested layers: CI + staging + manual

Candidate source/tests: `package.json`

### KAT-DEPLOY-001 · P0 · Typecheck and production build

Actions: Run npm run typecheck and npm run build on exact candidate commit

Expected: Both succeed; known baseline errors are tracked and not counted as a pass

Status: NOT_RUN

### KAT-DEPLOY-002 · P1 · Complete unit/component/SQL run

Actions: Run npm test with bounded workers; retain logs, failures and skips

Expected: Results are from actual completed execution; interrupted suites are Not Run/Incomplete

Status: NOT_RUN

### KAT-DEPLOY-003 · P0 · Preview backend isolation

Actions: Run preview E2E with demo enabled and unreachable fixture Supabase URL/key

Expected: Preview writes cannot contact real backend; test runner environment is verified before browser actions

Status: NOT_RUN

### KAT-DEPLOY-004 · P0 · Staging prerequisites and project discovery

Actions: List Playwright projects with and without configured staging environment

Expected: Missing staging project is recorded Not Run/Blocked, never successful authenticated coverage

Status: NOT_RUN

### KAT-DEPLOY-005 · P0 · Migration inventory and compatibility

Actions: Review pending migrations; apply candidate only to isolated clone; exercise old/new client reads

Expected: Intended schema/RLS works; unrelated migrations are not silently deployed; incompatibilities block release

Status: NOT_RUN

### KAT-DEPLOY-006 · P0 · Environment secret/config validation

Actions: Validate required Google/push/provider/service/vault environment presence without printing values

Expected: Missing configuration is reported; privileged secrets never appear in VITE/public environment

Status: NOT_RUN

### KAT-DEPLOY-007 · P1 · Post-deployment smoke

Actions: After approved deployment, run safe login/navigation/core read smoke against recorded build

Expected: Deployed commit/environment matches tested candidate; production verification uses approved non-destructive fixtures

Status: NOT_RUN

### KAT-DEPLOY-008 · P0 · Rollback/recovery rehearsal

Actions: Rehearse application rollback and database backup restore on disposable clone

Expected: Verified recovery procedure preserves required data; destructive production rollback is not performed by testing agent

Status: NOT_RUN

### KAT-DEPLOY-009 · P1 · Evidence and release report

Actions: Collect case IDs, attempt outcomes, exact build, environment and sanitized artifacts

Expected: Coverage denominator includes Fail/Blocked/Not Run/N/A; no rerun erases earlier failures

Status: NOT_RUN

### KAT-DEPLOY-010 · P0 · Release gate enforcement

Actions: Try declaring ready with unresolved P0/P1, stale evidence or blocked required integrations

Expected: Release stays blocked until critical acceptance is demonstrated or explicitly approved scope changes are recorded

Status: NOT_RUN
