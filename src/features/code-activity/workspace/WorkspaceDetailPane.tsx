import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Ellipsis, ExternalLink, FileText, GitBranch, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChecksPanel } from "../ChecksPanel";
import { relativeTime } from "../format";
import { Notice, Spinner } from "../ui-parts";
import { FileDiffPanel, FileMark } from "./DiffView";
import type { DiffMode } from "./DiffView";
import type { DetailPhase } from "./use-workspace";
import type { WorkspaceDetail, WorkspaceItem } from "./types";
import { Avatar, CONTROL, ShaCopy, Signed } from "./WorkspaceParts";

type Tab = "overview" | "files" | "checks";
const TABS: Tab[] = ["overview", "files", "checks"];

function StatChip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "ok" | "bad" | "add" | "del" }) {
  const style = { neutral: "border-[var(--ca-line)] text-[var(--ca-ink-2)]", ok: "border-transparent bg-[var(--ca-ok-bg)] text-[var(--ca-ok-ink)]", bad: "border-transparent bg-[var(--ca-bad-bg)] text-[var(--ca-bad-ink)]", add: "border-[var(--ca-line)] text-[var(--ca-add-ink)]", del: "border-[var(--ca-line)] text-[var(--ca-del-ink)]" }[tone];
  return <span className={cn("inline-flex min-h-[34px] items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium", style)}>{children}</span>;
}

/** Unified is the default at every width; side by side is one click away and needs room to be readable. */
const DEFAULT_MODE: DiffMode = "unified";

export function WorkspaceDetailPane({ phase, item, now, canCreate, onCreateThing, onBack, onRetry }: { phase: DetailPhase; item: WorkspaceItem | null; now: number; canCreate: boolean; onCreateThing: (d: WorkspaceDetail) => void; onBack: () => void; onRetry: () => void }) {
  return (
    <div className="ca-detail" aria-live="polite">
      <button type="button" onClick={onBack} className={cn(CONTROL, "ca-back m-3")}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to activity
      </button>
      {phase.kind === "none" || !item ? (
        <div className="grid min-h-[320px] place-items-center px-8 py-14 text-center">
          <div>
            <FileText className="mx-auto h-8 w-8 text-[var(--ca-muted)]" aria-hidden="true" />
            <p className="mt-3 text-[15px] font-semibold">Select a change</p>
            <p className="mt-1 max-w-xs text-[13px] text-[var(--ca-muted)]">Choose a commit or pull request on the left to see its files, patches and checks.</p>
          </div>
        </div>
      ) : phase.kind === "loading" ? (
        <div role="status" aria-label="Loading change" className="space-y-4 p-6">
          <h2 className="text-[22px] font-semibold leading-7">{item.title}</h2>
          <div className="flex items-center gap-2 text-[13px] text-[var(--ca-muted)]"><Spinner /> Reading from GitHub…</div>
          <div className="h-24 animate-pulse rounded-xl bg-[var(--ca-surface-soft)] motion-reduce:animate-none" />
        </div>
      ) : phase.kind === "error" ? (
        <div role="alert" className="p-6">
          <h2 className="text-[22px] font-semibold leading-7">{item.title}</h2>
          <p className="mt-2 text-[13px] text-[var(--ca-muted)]">{phase.message} The list on the left is unaffected.</p>
          <button type="button" onClick={onRetry} className={cn(CONTROL, "mt-4")}>Try again</button>
        </div>
      ) : (
        <DetailBody key={phase.detail.id} detail={phase.detail} now={now} canCreate={canCreate} onCreateThing={onCreateThing} />
      )}
    </div>
  );
}

function DetailBody({ detail, now, canCreate, onCreateThing }: { detail: WorkspaceDetail; now: number; canCreate: boolean; onCreateThing: (d: WorkspaceDetail) => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [fileIndex, setFileIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<DiffMode | null>(null);
  const activeMode = mode ?? DEFAULT_MODE;
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement>());
  const files = useMemo(() => detail.files.filter((f) => f.path.toLowerCase().includes(search.trim().toLowerCase())), [detail.files, search]);
  const file = files[Math.min(fileIndex, Math.max(0, files.length - 1))] ?? null;
  const passed = detail.checks.filter((r) => r.status === "completed" && (r.conclusion === "success" || r.conclusion === "neutral" || r.conclusion === "skipped")).length;
  const stats = detail.stats;
  const when = relativeTime(detail.occurredAt, now);
  const verb = detail.kind === "commit" ? "committed" : detail.kind === "pull_request" ? "updated" : detail.kind === "deployment" ? "deployed" : "pushed";

  const counts: Record<Tab, number | null> = { overview: null, files: detail.files.length > 0 || !detail.filesPartial ? detail.files.length : null, checks: detail.checks.length };
  const onTabKey = (e: React.KeyboardEvent, t: Tab) => {
    const i = TABS.indexOf(t);
    const next = e.key === "ArrowRight" ? TABS[(i + 1) % 3] : e.key === "ArrowLeft" ? TABS[(i + 2) % 3] : e.key === "Home" ? TABS[0] : e.key === "End" ? TABS[2] : null;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <div>
      <div className="px-4 pb-0 pt-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="min-w-0 flex-1 text-[20px] font-semibold leading-7 [overflow-wrap:anywhere]">{detail.title}</h2>
          <div className="flex shrink-0 items-center gap-2">
            {canCreate && detail.kind !== "deployment" ? (
              <button type="button" onClick={() => onCreateThing(detail)} className={cn(CONTROL, "border-transparent bg-[var(--ca-accent)] text-white hover:opacity-90 hover:bg-[var(--ca-accent)]")}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create Thing
              </button>
            ) : null}
            {detail.url ? (
              <a href={detail.url} target="_blank" rel="noopener noreferrer" className={CONTROL}>
                Open on GitHub
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="More actions" className={cn(CONTROL, "w-9 justify-center px-0")}><Ellipsis className="h-4 w-4" aria-hidden="true" /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {detail.sha ? <DropdownMenuItem onSelect={() => void navigator.clipboard?.writeText(detail.sha as string)}>Copy full SHA</DropdownMenuItem> : null}
                {detail.url ? <DropdownMenuItem onSelect={() => void navigator.clipboard?.writeText(detail.url as string)}>Copy GitHub link</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
          <Avatar author={detail.author} size={28} />
          <span className="font-medium">{detail.author.name}</span>
          <span className="text-[var(--ca-muted)]">{verb} {when}</span>
          <ShaCopy sha={detail.sha} />
          {detail.branch ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ca-surface-soft)] px-2.5 py-0.5 text-[12.5px] text-[var(--ca-ink-2)]">
              <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="ca-code">{detail.branch}</span>
              {detail.base ? <><span aria-hidden="true">→</span><span className="sr-only">into</span><span className="ca-code font-semibold">{detail.base}</span></> : null}
            </span>
          ) : null}
        </div>

        {detail.kind !== "deployment" ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatChip><FileText className="h-4 w-4" aria-hidden="true" />{stats?.files === null || stats?.files === undefined ? "Files not counted" : `${stats.files} ${stats.files === 1 ? "file" : "files"} changed`}</StatChip>
            <StatChip tone="add">{stats?.additions === null || !stats ? "+– additions" : `+${stats.additions} additions`}</StatChip>
            <StatChip tone="del">{stats?.deletions === null || !stats ? "−– deletions" : `−${stats.deletions} deletions`}</StatChip>
            {detail.checks.length > 0 ? (
              <StatChip tone={detail.checkState === "failing" ? "bad" : detail.checkState === "passed" ? "ok" : "neutral"}>
                <Check className="h-4 w-4" aria-hidden="true" />
                {passed} / {detail.checks.length} checks passed
              </StatChip>
            ) : (
              <StatChip>{detail.checkState === "unavailable" ? "Check status unavailable" : "No checks reported"}</StatChip>
            )}
          </div>
        ) : null}
      </div>

      {detail.kind === "deployment" ? (
        <DeploymentFacts detail={detail} />
      ) : (
        <>
          <div role="tablist" aria-label="Change sections" className="mt-4 flex gap-6 border-b border-[var(--ca-line)] px-6">
            {TABS.map((t) => (
              <button
                key={t}
                ref={(el) => { if (el) tabRefs.current.set(t, el); }}
                type="button"
                role="tab"
                id={`ca-tab-${t}`}
                aria-selected={tab === t}
                aria-controls={`ca-panel-${t}`}
                tabIndex={tab === t ? 0 : -1}
                onClick={() => setTab(t)}
                onKeyDown={(e) => onTabKey(e, t)}
                className={cn("-mb-px inline-flex min-h-[44px] cursor-pointer items-center gap-2 border-b-2 px-0.5 text-[14px] capitalize outline-none focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]", tab === t ? "border-[var(--ca-accent)] font-semibold" : "border-transparent text-[var(--ca-ink-2)] hover:text-[var(--ca-ink)]")}
              >
                {t}
                {counts[t] !== null ? <span className="rounded-md bg-[var(--ca-surface-soft)] px-1.5 text-[12px] text-[var(--ca-ink-2)]">{counts[t]}</span> : null}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`ca-panel-${tab}`} aria-labelledby={`ca-tab-${tab}`} tabIndex={0} className="outline-none">
            {tab === "overview" ? (
              <div className="space-y-3 px-6 py-5">
                {detail.body ? <p className="max-w-[72ch] whitespace-pre-wrap text-[14px] leading-6 [overflow-wrap:anywhere]">{detail.body}</p> : <p className="text-[13px] text-[var(--ca-muted)]">No description was written for this change.</p>}
                {detail.filesPartial ? <Notice tone="info"><b>Large change.</b> GitHub lists the first {detail.files.length} files only. Totals above come from GitHub and cover every file.</Notice> : null}
                {detail.filesUnavailableReason === "revision_changed" ? <Notice tone="warn"><b>Files are not shown.</b> The change moved to a newer revision while it was being read.</Notice> : null}
              </div>
            ) : tab === "files" ? (
              <div className="ca-files">
                <div className="min-w-0 p-3">
                  <div className="flex items-center justify-between px-2 pb-2">
                    <h3 className="text-[14px] font-semibold">Files changed</h3>
                    <span className="rounded-md bg-[var(--ca-surface-soft)] px-1.5 text-[12px]">{detail.files.length}</span>
                  </div>
                  {detail.files.length === 0 ? (
                    <p className="px-2 py-3 text-[13px] text-[var(--ca-muted)]">{detail.filesUnavailableReason ? "Files are not shown for this revision." : detail.filesPartial ? "GitHub did not list files for this change." : "This change touches no files."}</p>
                  ) : (
                    <ul aria-label="Files changed">
                      {detail.files.map((f) => {
                        const idx = files.indexOf(f);
                        if (idx === -1) return null;
                        return (
                          <li key={f.path}>
                            <button type="button" onClick={() => setFileIndex(idx)} aria-current={file === f ? "true" : undefined} className={cn("flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]", file === f ? "bg-[var(--ca-accent-soft)] shadow-[inset_3px_0_0_var(--ca-accent)]" : "hover:bg-[var(--ca-surface-soft)]")}>
                              <FileMark status={f.status} />
                              <span className="min-w-0">
                                <span className="block truncate text-[13px] font-medium" title={f.path}>{f.path}</span>
                                <span className="flex gap-2 text-[12px]"><Signed value={f.additions} kind="add" /><Signed value={f.deletions} kind="del" /></span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {detail.filesPartial ? <p className="px-2 pt-2 text-[12px] text-[var(--ca-muted)]">Showing the first {detail.files.length} files. More exist on GitHub.</p> : null}
                </div>
                <div className="min-w-0 space-y-3 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="relative block min-w-[180px] flex-1">
                      <span className="sr-only">Search files</span>
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ca-muted)]" aria-hidden="true" />
                      <input value={search} onChange={(e) => { setSearch(e.target.value); setFileIndex(0); }} placeholder="Search files…" className="ca-control h-9 w-full rounded-[10px] border border-[var(--ca-line)] pl-9 pr-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]" />
                    </label>
                    <div role="group" aria-label="Diff layout" className="inline-flex rounded-[10px] border border-[var(--ca-line)] p-0.5">
                      {(["unified", "split"] as const).map((m) => (
                        <button key={m} type="button" aria-pressed={activeMode === m} onClick={() => setMode(m)} className={cn("ca-control min-h-[32px] cursor-pointer rounded-lg px-3 text-[13px] capitalize outline-none focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]", activeMode === m ? "bg-[var(--ca-accent-soft)] font-semibold text-[var(--ca-accent-ink)]" : "text-[var(--ca-ink-2)]")}>{m}</button>
                      ))}
                    </div>
                  </div>
                  {file ? <FileDiffPanel key={file.path} file={file} revision={detail.sha} openUrl={detail.url} mode={activeMode} /> : <p className="py-6 text-center text-[13px] text-[var(--ca-muted)]">{search ? "No file matches that search." : "Select a file to see its patch."}</p>}
                </div>
              </div>
            ) : (
              <ChecksPanel
                change={{ checks: detail.checks, checkState: detail.checkState, checksRevision: detail.checksRevision, headSha: detail.sha, checksStale: detail.checksRevision !== null && detail.sha !== null && detail.checksRevision !== detail.sha, checksPartial: detail.checksPartial }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DeploymentFacts({ detail }: { detail: WorkspaceDetail }) {
  const d = detail.deployment;
  return (
    <div className="space-y-3 px-6 py-5">
      <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
        <dt className="text-[var(--ca-muted)]">Environment</dt><dd>{d?.environment ?? "Unknown"}</dd>
        <dt className="text-[var(--ca-muted)]">Latest status</dt><dd>{d?.state ?? "No status recorded"}</dd>
        <dt className="text-[var(--ca-muted)]">Ref</dt><dd className="ca-code">{d?.ref || "Unknown"}</dd>
      </dl>
      {d?.description ? <p className="text-[14px] leading-6">{d.description}</p> : null}
      <div className="flex gap-2">
        {d?.links.target ? <a className={CONTROL} href={d.links.target} target="_blank" rel="noopener noreferrer">Open deployment<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a> : null}
        {d?.links.log ? <a className={CONTROL} href={d.links.log} target="_blank" rel="noopener noreferrer">View log<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a> : null}
      </div>
      <p className="text-[12px] text-[var(--ca-muted)]">Read-only. Katalist shows deployment status from GitHub and never starts or changes a deployment.</p>
    </div>
  );
}
