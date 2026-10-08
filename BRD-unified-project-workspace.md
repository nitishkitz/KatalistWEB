# Business Requirements Document: Unified Project Workspace

**Status:** Draft for product review
**Date:** 2026-10-07

## 1. Executive summary

Create one project workspace that brings together Git/GitHub activity, Figma design work, documents and PDFs, project storage, and a dedicated secure vault for project credentials. The workspace should provide context and navigation across these systems without replacing specialist tools. Figma should be viewable through browser embeds and editable through an official “Open in Figma” action.

## 2. Problem

Project information is fragmented across repositories, design tools, files, credentials, and communication. Teams lose time switching tools, searching for the latest artifact, and determining which version or permission applies.

## 3. Goals

- Give each project one organized home.
- Connect GitHub and Figma without copying authoritative data unnecessarily.
- View permitted Figma files and prototypes in context.
- Make official editing destinations one click away.
- Store secrets separately with strong access controls and auditability.
- Provide search, activity, ownership, and permission context.

## 4. Non-goals

- Rebuilding the Figma editor or GitHub Desktop.
- Bypassing source-system permissions.
- Storing passwords as ordinary documents.
- Replacing enterprise password managers in the first release.

## 5. Users

- **Project owner:** connects services, manages members, and controls vault access.
- **Developer:** reviews repositories, commits, issues, and linked designs.
- **Designer:** reviews Figma files and opens them in Figma for editing.
- **Stakeholder:** views approved designs, PDFs, documents, and project status.
- **Administrator:** manages policies, audit history, and integrations.

## 6. MVP scope

1. Create projects and invite members.
2. Connect GitHub and display repository/activity summaries.
3. Connect Figma through OAuth 2 in the system browser.
4. List permitted Figma files and metadata.
5. Embed Figma Design files, FigJam boards, Slides, and prototypes for viewing where permitted.
6. Provide “Open in Figma” for editing and advanced actions.
7. Upload, organize, preview, and download documents and PDFs.
8. Add a separate encrypted secrets vault with role-based access and audit events.
9. Provide project-wide search over indexed metadata and user-authorized files.

## 7. Figma requirements

### Authentication

- Use Figma OAuth 2 with an explicit consent screen and least-privilege scopes.
- Run authorization in a normal browser; Figma does not support its OAuth flow inside an embedded WebView.
- Validate OAuth `state`, exchange short-lived authorization codes promptly, encrypt tokens at rest, and support token refresh and revocation.
- Never collect or store a user’s Figma password.

### Viewing and editing

- Build Figma embed URLs in the browser application using the official Embed Kit format.
- Preserve Figma’s sharing and permission model; an embed must not expose content the user cannot access in Figma.
- Treat file embeds as view-only. Include page selection, zoom, fullscreen, and prototype playback where supported.
- Provide a prominent “Open in Figma” action for editing, comments, and capabilities unavailable in the embed.
- Show the connected account and clear errors for revoked access, wrong account, unavailable file, or insufficient permission.

### API and synchronization

- Request only the scopes needed for the feature set, such as profile, metadata, file content, and comments when those features are implemented.
- Cache file metadata and thumbnails; refresh on demand and at reasonable intervals.
- Batch requests where possible, respect Figma rate-limit headers, retry after the indicated delay, and surface a non-destructive “Try again” state.
- Do not assume every Figma plan, seat type, or file-sharing configuration behaves identically.

## 8. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | Users can create a project workspace and invite members. | Must |
| FR-02 | Users can connect, disconnect, and reconnect GitHub and Figma integrations. | Must |
| FR-03 | The system lists only resources authorized for the connected user. | Must |
| FR-04 | A project dashboard shows linked repositories, Figma files, documents, PDFs, and recent activity. | Must |
| FR-05 | Users can open permitted Figma files/prototypes in an embedded viewer. | Must |
| FR-06 | Users can open the authoritative file in Figma for editing. | Must |
| FR-07 | Users can upload, tag, preview, and download project documents and PDFs. | Must |
| FR-08 | Secrets are stored in a distinct vault with separate permissions from files. | Must |
| FR-09 | Vault reads and administrative changes produce audit events. | Must |
| FR-10 | Users can search project metadata and authorized content. | Should |
| FR-11 | Users can link commits, pull requests, designs, and documents to project work items. | Should |

## 9. Security and privacy

- Encrypt data in transit and at rest; use a managed key service where available.
- Encrypt OAuth refresh tokens and vault values separately from ordinary application data.
- Use tenant/project isolation, least privilege, secure session handling, CSRF protection, and server-side authorization checks.
- Never log tokens, secret values, OAuth codes, or passwords.
- Support secret masking, reveal confirmation, copy timeout, rotation reminders, revoke access, and export/deletion policies.
- Maintain audit logs for integration changes, vault access, permission changes, and downloads.
- Define retention, backup, deletion, incident response, and recovery policies before production launch.

## 10. Non-functional requirements

- **Availability:** 99.5% monthly target for the workspace MVP, excluding external provider outages.
- **Performance:** dashboard shell in under 2 seconds on a typical broadband connection; lazy-load embeds and large documents.
- **Accessibility:** keyboard navigation, visible focus, labels, contrast, screen-reader support, and accessible error states.
- **Compatibility:** current versions of Chrome, Safari, Edge, and Firefox for the browser workspace.
- **Observability:** integration health, API error rate, rate limiting, embed failures, and vault access events.
- **Scalability:** asynchronous indexing and queued synchronization so large projects do not block the UI.

## 11. High-level data model

- `Workspace`: tenant, members, policy, subscription metadata.
- `Project`: workspace, name, owner, members, status, linked resources.
- `IntegrationConnection`: provider, owner, encrypted tokens, scopes, status, last sync.
- `ExternalResource`: provider ID, type, title, URL, permission summary, metadata cache.
- `Document`: project, storage key, type, tags, owner, version metadata.
- `Secret`: project, encrypted value, type, owner, rotation metadata, access policy.
- `AuditEvent`: actor, action, resource type, timestamp, outcome, safe metadata.

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Figma permissions differ from workspace permissions | Treat the provider as authoritative; re-check access before displaying content. |
| OAuth token theft | Encrypt tokens, keep them server-side, rotate sessions, and never expose secrets to the client. |
| Figma API rate limits | Cache, batch, queue, honor retry headers, and provide graceful stale-data states. |
| Users expect full Figma editing inside the workspace | Clearly label embeds as view-only and provide “Open in Figma.” |
| Vault becomes an unsafe file dump | Separate data model, UI, permissions, masking, audit, and security review. |
| Public OAuth launch is delayed by provider review | Start with a private organization app or limited pilot while preparing public review materials. |
| External provider outage | Show last synchronized metadata and provider-status-aware error states. |

## 13. Cost considerations

Figma’s OAuth and embed documentation does not establish a separate per-user integration fee. Costs still include application development, hosting, database/storage, bandwidth, monitoring, and security operations. Figma plan permissions, seat types, API rate limits, and public OAuth review requirements may affect product behavior and launch timing.

## 14. Success metrics

- 70% of active projects connect at least one external integration within 30 days.
- Median time from project creation to first linked artifact is under five minutes.
- 80% of Figma-linked sessions successfully reach a permitted preview or Figma destination.
- Less than 1% of integration requests fail due to avoidable application errors.
- Zero plaintext secrets in logs, client payloads, or ordinary document storage.
- Reduced time-to-find for a project artifact, measured by user research and search telemetry.

## 15. Rollout plan

### Phase 1: foundation

Projects, members, permissions, audit framework, document storage, and integration connection model.

### Phase 2: Figma and GitHub MVP

OAuth, resource listing, metadata caching, Figma embeds, “Open in Figma,” GitHub activity, and integration health states.

### Phase 3: secure vault

Encrypted secrets, access policies, masking, audit events, rotation reminders, and security review.

### Phase 4: intelligence and collaboration

Unified search, cross-resource links, comments/context, notifications, and richer project activity.

## 16. Acceptance criteria

- A user can connect Figma through a browser OAuth flow and return to the workspace.
- The workspace never asks for or stores the user’s Figma password.
- Only files visible to the connected Figma account appear in the resource list.
- A permitted Design file or prototype can be viewed in an embedded browser panel.
- A file embed is clearly view-only and includes a working official Figma destination.
- Revoked access and insufficient permissions produce understandable recovery guidance.
- Rate-limit responses do not duplicate requests uncontrollably or lose user data.
- Secrets cannot be retrieved by users without explicit vault permission.
- Secret values are masked by default and absent from logs and analytics.
- Audit records exist for connection, disconnection, vault reveal, and permission changes.

## 17. Open decisions

- Should the first release support only private organization workspaces or a public OAuth app?
- Which GitHub actions are read-only in MVP, and which require write permissions later?
- Will the vault be a limited project secret store or integrate with a dedicated secrets provider?
- Which document providers should be added after local upload: Google Drive, Dropbox, or OneDrive?
- What workspace-level retention and compliance requirements apply?

## 18. References

- [Figma Authentication](https://developers.figma.com/docs/rest-api/authentication/)
- [Figma OAuth Apps](https://developers.figma.com/docs/rest-api/oauth-apps/)
- [Embed a Figma File](https://developers.figma.com/docs/embeds/embed-figma-file/)
- [Figma Embed Overview](https://developers.figma.com/docs/embeds/)
- [Interact with Embeds](https://help.figma.com/hc/en-us/articles/360051741274-Interact-with-embeds)
- [Embed Files and Prototypes](https://help.figma.com/hc/en-us/articles/360039827134-Embed-files-and-prototypes)
- [Figma REST API Rate Limits](https://developers.figma.com/docs/rest-api/rate-limits/)
