# Figma productivity research and product plan

Date: 2026-10-08
Status: Proposed scope; implementation has not started.
Constraint: No Figma API credentials, OAuth app, REST calls, scraping, or account-wide file discovery.

## Product objective

Help employees find the relevant design, understand what to build, get a decision, and convert feedback into accountable work. The initial target group is designers, developers, QA, product managers, and stakeholders working on software projects. Expected productivity benefits are hypotheses until tested with Katalist users.

## Research evidence

- Atlassian's July 2025 survey of 3,500 developers and managers across six countries identifies information discovery, tool context switching, and collaboration as friction. These are self-reported vendor research findings, not a forecast of Katalist savings. [Source](https://www.atlassian.com/blog/developer/developer-experience-report-2025)
- Figma's April 2025 handoff guidance emphasizes early developer participation, embedded designs in developer workflows, scope alignment, responsive behavior, accessibility, and missing interface states. This is practitioner guidance, not a controlled productivity experiment. [Source](https://www.figma.com/blog/the-designers-handbook-for-developer-handoff/)
- A survey of 114 US UX practitioners finds that handoff challenges persist despite increased collaboration. This supports investigating workflow friction rather than assuming another viewer solves it. [Research paper](https://arxiv.org/abs/2302.11845)

## Supported foundation: include all previously agreed features

- Add Figma URLs for whole files, specific frames/pages, and prototype flows.
- Official embedded viewing for supported Design, FigJam, Slides, and prototype links.
- Viewer pan/zoom, page selection, and fullscreen where supported; interactive prototype playback.
- Persistent Open in Figma and copy-link actions.
- Editable Katalist title, description, tags, folders, favorites, owner, and optional uploaded cover.
- Search Katalist titles, tags, and notes; filter by type, owner, workflow state, and folder.
- Link designs to Things; discuss through existing Thing comments and mentions.
- Clear view-only labeling, manual retry, and an external-open fallback.

Basic embeds do not require API credentials. Figma controls access and its internal viewer; Katalist cannot read iframe contents, enumerate frames, reliably inspect every permission failure, fetch automatic metadata, or mirror Figma comments. [File embeds](https://developers.figma.com/docs/embeds/embed-figma-file/) · [Prototype embeds](https://developers.figma.com/docs/embeds/embed-figma-prototype/) · [Access](https://developers.figma.com/docs/embeds/security-access/)

## Highest-value workflows to validate

| Employee problem | Proposed behavior | Outcome to measure |
|---|---|---|
| Developer receives a file with hundreds of frames | Thing opens the exact supplied frame beside requirements | Time to locate relevant screen |
| Developer must repeatedly ask about behavior | Optional handoff brief: intent, responsive rules, loading/empty/error states, acceptance criteria, unresolved questions | Clarification requests and rework |
| Designer receives vague feedback in chat | Reviewer creates a Thing linked to the frame, with owner and expected outcome | Feedback-to-action time |
| Reviewer does not know what requires attention | Review queue filtered to assigned requests with deadline and decision status | Review turnaround |
| Team cannot tell what was approved | Review record includes manually uploaded snapshot/export, reviewer, decision, timestamp, and linked work | Revision confusion and reopened work |
| QA lacks an agreed reference | Design link, approved snapshot, checklist, and manually supplied staging URL together | Defect triage time |
| New employee lacks project context | Curated pinned designs, workflow map, glossary, and decision notes | Time to complete first relevant task |

These features are Katalist workflows. Their statuses, discussions, and decisions do not sync to Figma.

## Example end-to-end flow

Designer adds the checkout frame URL and a short handoff brief → requests review from a named teammate → reviewer opens the design and records a decision against an uploaded snapshot → unresolved feedback becomes assigned Things → developer opens the frame from their Thing → QA checks staging against the reviewed reference.

## Product rules

1. Adding a design requires only URL and title; progressively offer optional details. Do not make a large form mandatory.
2. Reuse Things for assignments, deadlines, comments, mentions, and completion. A design can link to multiple Things. Do not duplicate existing task statuses in a separate design task system.
3. Use a distinct review request with pending/approved/changes-requested/cancelled decisions, separate from Thing completion. Approval refers to the submitted evidence, not every future state of the live file.
4. A live link is a current reference. Without a saved export/screenshot or a supported explicit version link, a review has no immutable visual baseline. Katalist cannot detect subsequent Figma edits automatically.
5. Owners/collaborators manage resources; view-only members view permitted links. Review decision authority is explicitly assigned and server checked. Uploaded exports have Katalist access rules independent of Figma permissions; make sharing intentional.
6. Only relevant assignments, review requests, and decisions trigger notifications. Do not notify on ordinary opens or every note update. Prefer existing catch-up surfaces.
7. User-facing dates say Added, Updated in Katalist, or Reviewed. Never label local timestamps as Last changed in Figma.
8. Sanitize/validate Figma URLs, derive embeds internally, preserve supported frame/flow parameters, and never accept arbitrary iframe HTML.
9. Search indexes only Katalist-authored or explicitly uploaded material under the caller's permissions; it does not search Figma layers.

## Fit with present code

- Entry: Designs tab in `src/routes/lists.$listId.tsx`.
- Reuse List membership and invitations; new resource and link records scoped to `list_id` with database authorization policies.
- Reuse Thing detail/comments/mentions for contextual discussion and feedback work.
- Reuse private attachment/storage patterns for covers and review snapshots, with explicit resource association and access checks.
- New records: design_resources, design_thing_links, design_review_requests, design_review_decisions; optionally design_folders and tags. Names are provisional. Favorites belong to each user.
- Lazy-load an embed when selected. An iframe load event is not proof that the viewer could access the file.

## Delivery sequence

1. Validate workflows with employees before committing to advanced features.
2. Foundation: all supported link/view/organize/search features, persistent storage, permission checks, and Thing links. Prototype representative private/public files across target browsers.
3. Handoff: optional brief templates and feedback-to-Thing creation using existing assignment/comment flows.
4. Review: personal review queue, named reviewers, immutable uploaded evidence, decisions, and relevant notifications.
5. QA and onboarding: manual staging comparisons, checklists, pinned reference collections. Build only after pilot evidence supports them.

## Employee research and pilot

Recruit 6–8 employees across design, development, QA, and product. Run 30-minute sessions using a recently completed task and actual artifacts, with permission.

Ask: Where did you find the design? How did you identify the relevant frame? What did you ask before starting? What caused rework? Who approved it and against what reference? What happened to feedback? Which added data entry would feel burdensome?

Observe tasks: find a specified screen; explain the expected error behavior; request a review; turn feedback into owned work; identify the reviewed visual reference. Record task time, completion, errors, clarification needs, and perceived effort.

Collect a baseline before a two-week pilot with one team. Proposed targets, subject to baseline: 30% faster design discovery, 20% faster review turnaround, 20% fewer repeated clarification requests, and adding a simple design in under 30 seconds. Track wrong-reference incidents, notification burden, and metadata maintenance effort as guardrails. Report team-level workflow outcomes, not individual employee rankings. Do not treat iframe opens as successful reviews.

## Recommendation

Prioritize exact-frame Thing links, lightweight handoff context, and actionable feedback after the embed foundation. These have the clearest connection to existing Katalist capabilities. Account browsing, automatic Figma change detection, comment synchronization, layer inspection, and automated visual comparison remain outside this credential-free scope.
