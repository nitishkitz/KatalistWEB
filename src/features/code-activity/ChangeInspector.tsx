import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ChevronLeft, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { aiActionState, capabilitiesFor } from "./access";
import { ChecksPanel } from "./ChecksPanel";
import { CoeyDraftReview } from "./CoeyDraftReview";
import { FileDiff } from "./FileDiff";
import { checkSummaryText, fileCountLabel, initialsOf, middleEllipsis, relativeTime, shortSha, sizeLabel } from "./format";
import { CheckPill, Notice, PullRequestPill, SourceLink, Spinner } from "./ui-parts";
import type { CodeActivityAdapter, SummaryResult } from "./adapter";
import type { ActivityChange, AssigneeCandidate, ListRole } from "./types";

type Section = "overview" | "files" | "checks";

interface ChangeInspectorProps {
  change: ActivityChange;
  role: ListRole;
  consent: boolean;
  listName: string;
  adapter: CodeActivityAdapter;
  candidates: readonly AssigneeCandidate[];
  candidatesLoading?: boolean;
  candidatesError?: string | null;
  onRetryCandidates?: () => void;
  now: number;
  /** Return to the activity list. Shown below the desktop split width. */
  onBack: () => void;
  onOpenConsentSettings: () => void;
  onCreateManually?: () => void;
  /** False until Coey is released (G14): hides every AI action instead of showing disabled ones. Default true. */
  aiEnabled?: boolean;
  /** The live feature: a confirmed draft creates a real Thing and nothing is labeled Preview. */
  live?: boolean;
  onOpenThing?: (thingId: string) => void;
}

/**
 * The selected change: Overview, Files, and Checks, plus the entry to the Coey draft flow.
 * It is keyed by change id in its parent, so every change starts fresh on Overview.
 */
export function ChangeInspector({
  change,
  role,
  consent,
  listName,
  adapter,
  candidates,
  candidatesLoading,
  candidatesError,
  onRetryCandidates,
  now,
  onBack,
  onOpenConsentSettings,
  onCreateManually,
  aiEnabled = true,
  live = false,
  onOpenThing,
}: ChangeInspectorProps) {
  const [section, setSection] = useState<Section>("overview");
  const [mode, setMode] = useState<"view" | "draft">("view");
  const [draftStart, setDraftStart] = useState<"ai" | "manual">("ai");
  const [selectedPath, setSelectedPath] = useState<string | null>(change.files[0]?.path ?? null);
  const [summary, setSummary] = useState<{ status: "idle" | "loading" } | { status: "done"; result: SummaryResult }>({ status: "idle" });
  const draftButton = useRef<HTMLButtonElement>(null);
  const summaryAbort = useRef<AbortController | null>(null);

  const action = aiActionState(role, consent);
  const canCreate = capabilitiesFor(role).canCreateThings;
  const openUrl = change.sourceUrl ?? change.commitUrl;
  const file = change.files.find((f) => f.path === selectedPath) ?? null;

  useEffect(() => () => summaryAbort.current?.abort(), []);

  const closeDraft = useCallback(() => {
    setMode("view");
    // Return focus to the control that opened the draft.
    requestAnimationFrame(() => draftButton.current?.focus());
  }, []);

  const summarize = async () => {
    if (!(action.visible && action.enabled)) return;
    summaryAbort.current?.abort();
    const controller = new AbortController();
    summaryAbort.current = controller;
    setSummary({ status: "loading" });
    try {
      const result = await adapter.summarizeChange({ change }, controller.signal);
      if (!controller.signal.aborted) setSummary({ status: "done", result });
    } catch {
      if (!controller.signal.aborted) setSummary({ status: "done", result: { ok: false, reason: "unavailable" } });
    }
  };

  const tabs: ReadonlyArray<{ id: Section; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "files", label: `Files (${change.changedFiles ?? change.files.length})` },
    { id: "checks", label: `Checks (${change.checks.length})` },
  ];

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setSection(tabs[next].id);
    requestAnimationFrame(() => document.getElementById(`ca-tab-${tabs[next].id}`)?.focus());
  };

  const author = change.author.kind === "unknown" ? "Unknown author" : change.author.name;

  return (
    <article aria-label={`Change: ${change.title}`} className="min-w-0">
      <div className="border-b border-[#eef0f6] px-5 py-4 lg:px-7 lg:py-5">
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 mb-2 inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-[#503188] outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2] lg:hidden"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Activity
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold leading-snug text-[#000533] lg:text-[20px]">{change.title}</h2>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <PullRequestPill change={change} />
              <CheckPill change={change} />
              {change.checks.length > 0 && !change.checksStale ? (
                <span className="text-[12px] text-[#4d5878]">{checkSummaryText(change.checks)}</span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-[#6a769c]">
              <span
                aria-hidden="true"
                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#d9cff7] text-[12px] font-semibold text-[#503188]"
              >
                {change.author.kind === "unknown" ? "?" : initialsOf(change.author.name)}
              </span>
              <span>{author}</span>
              {change.headBranch ? (
                <span className="font-mono">
                  {change.headBranch}
                  {change.baseBranch ? ` → ${change.baseBranch}` : ""}
                </span>
              ) : null}
              {change.headSha ? (
                <span>
                  revision <span className="font-mono">{shortSha(change.headSha)}</span>
                </span>
              ) : null}
              <span>· updated {relativeTime(change.updatedAt, now)}</span>
            </div>
          </div>
          <SourceLink href={openUrl} className="rounded-lg border border-[#eaeffa] bg-white px-3 text-[13px] text-[#1d1d1d] no-underline">
            Open on GitHub
          </SourceLink>
        </div>
      </div>

      {mode === "draft" ? (
        <CoeyDraftReview
          key={draftStart}
          live={live}
          startMode={draftStart}
          onOpenThing={onOpenThing}
          change={change}
          role={role}
          consent={consent}
          listName={listName}
          adapter={adapter}
          candidates={candidates}
          candidatesLoading={candidatesLoading}
          candidatesError={candidatesError}
          onRetryCandidates={onRetryCandidates}
          onClose={closeDraft}
          onOpenConsentSettings={onOpenConsentSettings}
          onCreateManually={onCreateManually}
        />
      ) : (
        <>
          <div role="tablist" aria-label="Change sections" className="flex gap-6 border-b border-[#eef0f6] px-5 lg:px-7">
            {tabs.map((t, i) => (
              <button
                key={t.id}
                id={`ca-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={section === t.id}
                aria-controls={`ca-panel-${t.id}`}
                tabIndex={section === t.id ? 0 : -1}
                onClick={() => setSection(t.id)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={cn(
                  "relative min-h-[44px] cursor-pointer whitespace-nowrap py-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2] lg:min-h-0",
                  section === t.id ? "font-medium text-black" : "text-[#6a769c] hover:text-black",
                )}
              >
                {t.label}
                {section === t.id ? <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#975ee2]" /> : null}
              </button>
            ))}
          </div>

          <div role="tabpanel" id="ca-panel-overview" aria-labelledby="ca-tab-overview" hidden={section !== "overview"} className="flex flex-col gap-5 px-5 py-5 lg:px-7">
            <section>
              <h3 className="mb-1.5 text-[14px] font-semibold text-[#000533]">Description from GitHub</h3>
              {change.description ? (
                <div className="rounded-xl border border-[#eaeffa] bg-[#fcfcfe] px-4 py-3">
                  {/* Provider text is rendered as plain text only. */}
                  <p className="whitespace-pre-wrap break-words text-[13px] text-[#26304f]">{change.description}</p>
                  <p className="mt-1.5 text-[12px] text-[#6a769c]">Shown exactly as written on GitHub. Not generated by Katalist.</p>
                </div>
              ) : (
                <p className="text-[13px] text-[#6a769c]">No description was provided.</p>
              )}
            </section>
            <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-[13px] sm:grid-cols-[150px_1fr]">
              <dt className="text-[#6a769c]">Change size</dt>
              <dd className="font-mono">{sizeLabel(change.additions, change.deletions, change.changedFiles)}</dd>
              <dt className="text-[#6a769c]">Source</dt>
              <dd className="flex flex-wrap gap-x-3">
                <SourceLink href={change.sourceUrl}>{change.number ? `Pull request #${change.number}` : "Source"}</SourceLink>
                <SourceLink href={change.commitUrl}>Commit {shortSha(change.headSha)}</SourceLink>
              </dd>
              <dt className="text-[#6a769c]">Checks</dt>
              <dd>{change.checksRevision ? <>Evaluated on revision <span className="font-mono">{shortSha(change.checksRevision)}</span></> : "No revision reported"}</dd>
            </dl>

            {!aiEnabled ? (
              canCreate ? (
                <section aria-label="Create a Thing" className="flex flex-col gap-2.5">
                  <div className="flex flex-wrap gap-2.5">
                    <button
                      ref={draftButton}
                      type="button"
                      onClick={() => {
                        setDraftStart("manual");
                        setMode("draft");
                      }}
                      className="inline-flex h-[42px] cursor-pointer items-center gap-2 rounded-[9px] bg-[#975ee2] px-4 text-[14px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2] focus-visible:ring-offset-2"
                    >
                      Create a Thing from this change
                    </button>
                  </div>
                  <p className="text-[12px] text-[#6a769c]">You choose the title, the assignee, and the date. Nothing is created until you confirm.</p>
                </section>
              ) : (
                <p className="text-[12px] text-[#6a769c]">View Only members can read this change, its files, and its checks.</p>
              )
            ) : action.visible ? (
              <section aria-label="Coey actions" className="flex flex-col gap-2.5">
                <div className="flex flex-wrap gap-2.5">
                  <button
                    ref={draftButton}
                    type="button"
                    disabled={!action.enabled}
                    onClick={() => {
                      setDraftStart("ai");
                      setMode("draft");
                    }}
                    className="inline-flex h-[42px] cursor-pointer items-center gap-2 rounded-[9px] bg-[#975ee2] px-4 text-[14px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    Draft with Coey
                  </button>
                  <button
                    type="button"
                    disabled={!action.enabled || summary.status === "loading"}
                    onClick={() => void summarize()}
                    className="inline-flex h-[42px] cursor-pointer items-center gap-2 rounded-[9px] border border-[#eaeffa] bg-white px-4 text-[14px] font-medium text-[#1d1d1d] outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {summary.status === "loading" ? <Spinner /> : null}
                    Summarize change
                  </button>
                  {canCreate ? (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftStart("manual");
                        setMode("draft");
                      }}
                      className="inline-flex h-[42px] cursor-pointer items-center gap-2 rounded-[9px] border border-[#eaeffa] bg-white px-4 text-[14px] font-medium text-[#1d1d1d] outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2]"
                    >
                      Create a Thing myself
                    </button>
                  ) : null}
                </div>
                {action.enabled ? (
                  <p className="text-[12px] text-[#6a769c]">Drafting never creates anything. You review and confirm every Thing.</p>
                ) : (
                  <Notice tone="warn">
                    <b>Drafting is turned off.</b> {action.message}
                    {action.reason === "consent_off_owner" ? (
                      <button
                        type="button"
                        onClick={onOpenConsentSettings}
                        className="ml-2 min-h-[28px] cursor-pointer rounded-md border border-[#e0b95c] bg-white px-2 text-[12px] font-medium text-[#4a3a10] outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2]"
                      >
                        Open consent settings
                      </button>
                    ) : null}
                  </Notice>
                )}
                {summary.status === "done" ? (
                  summary.result.ok ? (
                    <div className="rounded-xl border border-[#c9c4fc] bg-[#f5f4fe] px-4 py-3" role="status">
                      <div className="text-[12px] font-semibold text-[#503188]">Summary from Coey (generated)</div>
                      <p className="mt-1 text-[13px] text-[#26304f]">{summary.result.text}</p>
                      <p className="mt-1.5 text-[12px] text-[#6a769c]">
                        Generated from revision <span className="font-mono">{shortSha(change.headSha)}</span>
                        {summary.result.partial ? " · partial input: some files were not fully read" : ""}. This is not the GitHub description.
                      </p>
                    </div>
                  ) : (
                    <Notice tone="bad" live="status">
                      <b>{summary.result.reason === "consent_withdrawn" ? "Drafting was turned off." : "The summary is unavailable right now."}</b>{" "}
                      The change, files, and checks are unaffected.
                    </Notice>
                  )
                ) : null}
              </section>
            ) : (
              <p className="text-[12px] text-[#6a769c]">View Only members can read this change, its files, and its checks.</p>
            )}
          </div>

          <div role="tabpanel" id="ca-panel-files" aria-labelledby="ca-tab-files" hidden={section !== "files"}>
            {change.files.length === 0 ? (
              <div className="px-7 py-6">
                <Notice tone="info">
                  {change.filesUnavailableReason === "revision_changed" ? (
                    <>
                      <b>Files are not shown.</b> This pull request changed while it was being read, so the files could not be matched to one
                      revision. Close and open it again, or <SourceLink href={openUrl}>open it on GitHub</SourceLink>.
                    </>
                  ) : (
                    <>
                      <b>No files to show.</b> The file list is not available for this change. <SourceLink href={openUrl}>Open on GitHub</SourceLink>
                    </>
                  )}
                </Notice>
              </div>
            ) : (
              <div className="flex flex-col md:flex-row">
                <ul aria-label="Changed files" className="max-h-48 shrink-0 overflow-auto border-b border-[#eef0f6] py-2 md:max-h-none md:w-[270px] md:border-b-0 md:border-r">
                  {change.files.map((f) => (
                    <li key={f.path}>
                      <button
                        type="button"
                        aria-current={f.path === selectedPath ? "true" : undefined}
                        title={f.path}
                        onClick={() => setSelectedPath(f.path)}
                        className={cn(
                          "flex min-h-[36px] w-full cursor-pointer items-center justify-between gap-2 px-4 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#975ee2]",
                          f.path === selectedPath ? "bg-[#f5f4fe] shadow-[inset_3px_0_0_#975ee2]" : "hover:bg-[#fafaff]",
                        )}
                      >
                        <span className="min-w-0 truncate font-mono text-[12px]">{middleEllipsis(f.path)}</span>
                        <span className="shrink-0 font-mono text-[12px] text-[#4d5878]">{fileCountLabel(f)}</span>
                      </button>
                    </li>
                  ))}
                  {change.filesPartial || (change.changedFiles !== null && change.files.length < change.changedFiles) ? (
                    <li className="px-4 py-2 text-[12px] text-[#7a4d00]">
                      Showing {change.files.length} of {change.changedFiles ?? "more"} files. The rest are on GitHub.
                    </li>
                  ) : null}
                </ul>
                <div className="min-w-0 flex-1 px-5 py-4">
                  {file ? (
                    <FileDiff key={file.path} file={file} revision={change.headSha} openUrl={change.commitUrl ?? change.sourceUrl} />
                  ) : (
                    <p className="text-[13px] text-[#6a769c]">Choose a file to read its patch.</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div role="tabpanel" id="ca-panel-checks" aria-labelledby="ca-tab-checks" hidden={section !== "checks"}>
            <ChecksPanel change={change} />
          </div>
        </>
      )}
    </article>
  );
}
