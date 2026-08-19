# Katalist Frontend — Reordered Implementation Plan

No code changes were made in this turn. This is a plan-order correction only. The backend schema, Supabase migrations, RPCs, RLS, auth logic, and lifecycle behavior remain untouched.

---

## LOCKED REFERENCES

- The uploaded visual references (Court, Lists, Buckets, Nudges, Me, Login/Phone OTP/QR, Onboarding, app icon/logo) are the visual source of truth.
- The Katalist Master Concept BRD v2.1 remains authoritative for product semantics, permissions, and lifecycle behavior.
- The five-item navigation is fixed: Court, Lists, Buckets, Nudges, Me.
- The logo is locked and must be used as provided.

---

## PHASE 0 — SHARED VISUAL FOUNDATION

No business logic. Establish only the visual system that every later phase reuses.

- Locked design tokens in `src/styles.css`:
  - Warm off-white background (`#F9F9F8` family)
  - White / light neutral cards
  - Charcoal/graphite text hierarchy
  - Muted secondary text
  - Restrained indigo/violet accent for actions and active nav only
  - Semantic status colors: red (NOW / urgent), blue (Under Progress / NEXT), amber (WAITING), green (Caught / sorted), neutral (Not Started)
  - Radius, border, soft-shadow tokens
- Typography hierarchy matching the references: large bold page titles, small muted subtitles, dense 13-14px table rows
- Exact Katalist logo asset integration via Lovable Assets (cat-outline mark + wordmark); never regenerated
- Shared primitive components:
  - `PageHeader`, `SectionCard`, `DataTable` row styling
  - Status pills (NOW, NEXT, LATER, WAITING, IN PROGRESS)
  - Chips, filter tabs, search input, sort/filter buttons
  - Primary / secondary / ghost buttons
  - Empty-state row with mascot line
- Responsive app shell primitives

## PHASE 1 — ONBOARDING + AUTH ENTRY

Build the first-time and returning-user entry path before any authenticated product screen. Each flow must match the locked references and BRD.

- Welcome / onboarding screens (6-step reference flow: Welcome, Capture anything, Organize, Nudge, Collaborate, Celebrate)
- Phone-number login with country-code handling
- OTP verification
- QR login (where included in the locked reference set)
- Contact-permission soft ask / permission state where applicable
- Session detection and auth redirect rules
- Existing-user restore path
- New-user continuation path
- No onboarding steps invented outside the approved references/BRD

## PHASE 2 — AUTHENTICATED APP SHELL + COURT

After successful auth/onboarding, build the authenticated container and the first product screen.

- Authenticated app shell:
  - Fixed left sidebar with Katalist mark + wordmark
  - Exactly five nav items: Court, Lists, Buckets, Nudges, Me
  - Active item highlight with left accent bar
  - Bottom Work/Home context switcher
  - Top-right notification bell with dot, avatar with presence dot and chevron
- PageHeader component on every authenticated page
- Court as the post-login home route (`/`)
- Court must follow locked BRD semantics and approved visual reference
- Court state: NOW / NEXT / LATER / THEIRS groupings, counts, summary cards, "Toss a thought..." input, search, sort, filter

## PHASE 3 — CORE THING INTERACTION FLOWS

After Court is stable, build the canonical Thing interactions. Reuse one canonical Thing; do not duplicate state.

- Thing Detail view
- Magic Box / Create & Toss
- Caught It action
- Work Status (Not Started → Under Progress → Sorted)
- Owner Importance
- Personal Pace
- Due date/time
- Assign / Reassign
- Cancel
- Mark Sorted
- Thing Comments / Activity
- Add to Bucket
- Search / filters

## PHASE 4 — LISTS

- Lists Home
- List Detail
- Create List
- Members & Permissions
- View Only state
- List Chat
- Thing-only to List membership promotion flow

## PHASE 5 — BUCKETS

- Buckets Home
- Bucket Detail
- Create / Edit Bucket
- Private Bucket behavior only

## PHASE 6 — NUDGES

- Nudges Home
- Nudge Detail / Follow-up
- Status buckets: Waiting for Catch, Needs a Tap, Recently Nudged, Caught & Moving, Stale / Review

## PHASE 7 — ME

- Profile Home
- Trophy / Stats
- Work/Home preferences
- Notification preferences
- Nudge preferences
- Privacy
- Recently Shredded
- Subscription
- Appearance
- Sound / haptics
- Help / account

## PHASE 8 — BRIDGE / EXTERNAL USER WEB FLOW

- Secure Thing-only Bridge view
- Caught It for Bridge users
- Work Status for Bridge users
- Comment
- Sorted
- No List access
- No Personal Pace

## PHASE 9 — SECONDARY / SYSTEM STATES

- Spring Cleaning / Recently Shredded
- Doorman Ghost Card
- Loading / empty / offline / error states
- Attachment states where implemented
- Remaining deferred presentation states

---

## IMPLEMENTATION RULES

- Work phase-by-phase. Stop for approval after each phase.
- Do not implement all phases at once.
- Before implementing any screen, compare it directly against its locked reference image.
- If a reference image contains sample data that conflicts with the BRD, preserve the visual style and correct the behavior to match the BRD.
- Backend is already established; frontend consumes existing Supabase types, RPCs, RLS, and lifecycle rules. Do not redesign backend contracts.
- No changes to Supabase schema, migrations, RPCs, RLS, auth logic, or backend behavior as part of frontend implementation.
- No code changes were made while producing this corrected plan.
