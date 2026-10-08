import { useId, useMemo, useState } from "react";
import { Github } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { matchRepository } from "./repository";
import type { SelectableRepository } from "./repository";
import { Notice, Spinner } from "./ui-parts";

const BTN_PRIMARY =
  "inline-flex h-[42px] cursor-pointer items-center gap-2 rounded-[9px] bg-[#975ee2] px-4 text-[14px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45";
const BTN_SECONDARY =
  "inline-flex h-[42px] cursor-pointer items-center gap-2 rounded-[9px] border border-[#eaeffa] bg-white px-4 text-[14px] font-medium text-[#1d1d1d] outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2]";

const SHARING_SENTENCE =
  "Everyone in this List will be able to read this repository’s activity, checks, and available diffs, including View Only members.";

export type Readiness = "loading" | "unavailable" | "setup_pending" | "ready";

const READINESS_COPY: Record<Exclude<Readiness, "ready">, string> = {
  loading: "Checking GitHub connection…",
  unavailable: "GitHub connection is unavailable for this List.",
  setup_pending: "GitHub integration is not enabled yet. Katalist\u2019s operator needs to finish setup.",
};

/**
 * The connector card: a GitHub mark, one heading, one sentence, one primary action. The owner always SEES the Connect
 * action so it can be found; it is enabled only when the server says the feature is ready. A member never gets an
 * action: the server is the authority, the button is only a convenience.
 */
export function ConnectorCard({
  readiness,
  isOwner,
  variant = "unconnected",
  busy = false,
  onConnect,
}: {
  readiness: Readiness;
  isOwner: boolean;
  variant?: "unconnected" | "disconnected" | "revoked";
  busy?: boolean;
  /** Absent means the action cannot run, whatever else is true. */
  onConnect?: () => void;
}) {
  const explainId = useId();
  const ready = readiness === "ready";
  const heading = variant === "revoked" ? "GitHub access needs verification." : variant === "disconnected" ? "Repository disconnected" : "Connect GitHub";
  let body: string;
  if (!ready) body = READINESS_COPY[readiness];
  else if (!isOwner) body = variant === "revoked" ? "Ask the List owner to reconnect it." : "Only the List owner can connect GitHub.";
  else if (variant === "revoked") body = "GitHub access for the repository can no longer be confirmed. Connect again to choose a repository.";
  else if (variant === "disconnected") body = "Saved activity is no longer shown. Things you created from it remain.";
  else body = "Use your GitHub account to choose a repository for this List.";
  const enabled = ready && isOwner && !busy && onConnect !== undefined;

  return (
    <div className="px-5 py-6 lg:px-8 lg:py-8" data-code-activity-state={`connector-${readiness}`}>
      <div className="flex max-w-2xl items-start gap-4 rounded-xl border border-[#eaeffa] bg-white p-5 lg:p-6">
        <span aria-hidden="true" className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#f4f5fa] text-[#000533]">
          {readiness === "loading" ? <Spinner className="h-5 w-5" /> : <Github className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] font-semibold text-[#000533]">{heading}</h3>
          <p id={explainId} role={ready ? undefined : "status"} className="mt-1 text-[13px] text-[#26304f]">
            {body}
          </p>
          {ready && isOwner && variant === "unconnected" ? (
            <p className="mt-1 text-[12px] text-[#6a769c]">Katalist only reads from GitHub. You confirm who can see it before anything is connected.</p>
          ) : null}
          {isOwner ? (
            <button
              type="button"
              disabled={!enabled}
              aria-describedby={explainId}
              onClick={onConnect}
              className={cn(BTN_PRIMARY, "mt-4")}
            >
              {busy ? "Opening GitHub\u2026" : "Connect GitHub"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Shown before anything is connected, once the server says it is ready. */
export function UnconnectedPanel({
  isOwner,
  variant,
  busy,
  onConnect,
}: {
  isOwner: boolean;
  variant: "unconnected" | "disconnected" | "revoked";
  busy?: boolean;
  /** Absent means the action cannot run: the button is then disabled. */
  onConnect?: () => void;
}) {
  return <ConnectorCard readiness="ready" isOwner={isOwner} variant={variant} busy={busy} onConnect={onConnect} />;
}

/** Step two: choose a verified repository and acknowledge sharing. The acknowledgement is separate from AI consent. */
export function RepositorySelection({
  repositories,
  onCancel,
  onConnect,
  busy = false,
  error = null,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: {
  /** Repositories the server verified for this owner and List. Never typed-in or sample data. */
  repositories: readonly SelectableRepository[];
  onCancel: () => void;
  onConnect: (fullName: string) => void;
  busy?: boolean;
  error?: string | null;
  /** More verified repositories exist on the server. Without this the list would stop at the first page. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const urlId = useId();
  const ackId = useId();

  const typedMatch = useMemo(() => (url.trim() === "" ? null : matchRepository(url, repositories)), [url, repositories]);
  const urlProblem = url.trim() !== "" && typedMatch === null;
  const chosen = typedMatch ?? repositories.find((r) => r.id === selectedId) ?? null;
  const canConnect = chosen !== null && acknowledged && !urlProblem && !busy;

  return (
    <div className="grid gap-6 px-5 py-6 lg:grid-cols-[1.4fr_1fr] lg:px-8">
      <section aria-labelledby="ca-choose" className="rounded-xl border border-[#eaeffa] bg-white p-5">
        <ol className="mb-4 flex flex-wrap gap-2 text-[12px]">
          <li className="rounded-full border border-[#bfe3cd] bg-[#e6f5ec] px-2.5 py-0.5 text-[#17663f]">✓ 1 Authorized on GitHub</li>
          <li className="rounded-full border border-[#c9c4fc] bg-[#f5f4fe] px-2.5 py-0.5" aria-current="step">2 Choose repository</li>
          <li className="rounded-full border border-[#eaeffa] px-2.5 py-0.5 text-[#4d5878]">3 Confirm sharing</li>
        </ol>
        <h3 id="ca-choose" className="text-[16px] font-semibold text-[#000533]">Choose one repository for this List</h3>
        <p className="mb-3 mt-1 text-[12px] text-[#6a769c]">
          These repositories are reachable by both your GitHub account and the Katalist GitHub App. A List connects to one repository.
        </p>
        <fieldset>
          <legend className="sr-only">Repository</legend>
          <div className="overflow-hidden rounded-[10px] border border-[#eaeffa]">
            {repositories.map((r) => (
              <label
                key={r.id}
                className={cn(
                  "flex min-h-[60px] cursor-pointer items-center gap-3 border-b border-[#eef0f6] px-4 py-2 last:border-b-0 focus-within:ring-2 focus-within:ring-inset focus-within:ring-[#975ee2]",
                  chosen?.id === r.id && "bg-[#f5f4fe] shadow-[inset_3px_0_0_#975ee2]",
                )}
              >
                <input
                  type="radio"
                  name="ca-repo"
                  className="h-4 w-4 accent-[#975ee2]"
                  checked={chosen?.id === r.id}
                  onChange={() => {
                    setSelectedId(r.id);
                    setUrl("");
                  }}
                />
                <span>
                  <span className="block font-mono text-[13px] font-semibold text-[#000533]">{r.fullName}</span>
                  <span className="block text-[12px] text-[#6a769c]">
                    {r.visibility === "private" ? "Private" : "Public"} · {r.updatedLabel}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {hasMore ? (
          <button type="button" onClick={onLoadMore} disabled={loadingMore} className={cn(BTN_SECONDARY, "mt-3")}>
            {loadingMore ? "Loading…" : "Load more repositories"}
          </button>
        ) : null}
        <div className="mt-4 flex flex-col gap-1.5">
          <label htmlFor={urlId} className="text-[12.5px] font-semibold text-[#000533]">Or paste a repository URL</label>
          <input
            id={urlId}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setSelectedId(null);
            }}
            placeholder="https://github.com/example-org/website"
            aria-invalid={urlProblem || undefined}
            aria-describedby={`${urlId}-help`}
            className={cn(
              "min-h-[42px] w-full rounded-[9px] border bg-white px-3 text-[14px] outline-none focus-visible:border-[#975ee2] focus-visible:ring-[3px] focus-visible:ring-[#975ee2]/25",
              urlProblem ? "border-[#fc404d]" : "border-[#d6dbea]",
            )}
          />
          <p id={`${urlId}-help`} className={cn("text-[12px]", urlProblem ? "text-[#a61b2b]" : "text-[#6a769c]")}>
            {urlProblem
              ? "That repository is not in the list above. A URL alone never connects."
              : "The URL must match a repository listed above. A URL alone never connects."}
          </p>
        </div>
        <Notice tone="info" className="mt-4">
          Not listed? Install the GitHub App on <b>selected repositories</b>, not all repositories, then return here.
        </Notice>
      </section>

      <section aria-labelledby="ca-confirm" className="h-fit rounded-xl border border-[#eaeffa] bg-white p-5">
        <h3 id="ca-confirm" className="text-[16px] font-semibold text-[#000533]">Confirm sharing</h3>
        <p className="mb-3 mt-1 text-[12px] text-[#6a769c]">
          Connecting {chosen ? <span className="font-mono">{chosen.fullName}</span> : "a repository"} lets Katalist read its pull requests, pushes, checks, and available diffs.
        </p>
        <Notice tone="warn" className="mb-3">
          This repository&rsquo;s content will be readable by <b>every member of this List, including View Only members</b>. They can read it but cannot connect, disconnect, or create from it.
        </Notice>
        <div className="flex items-start gap-3">
          <input
            id={ackId}
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 h-5 w-5 accent-[#975ee2]"
            aria-describedby={`${ackId}-help`}
          />
          <label htmlFor={ackId} className="text-[13px] text-[#26304f]">
            I understand that everyone in this List, including View Only members, will be able to read this repository&rsquo;s activity, checks, and available diffs.
          </label>
        </div>
        <p id={`${ackId}-help`} className="mb-4 ml-8 mt-1 text-[12px] text-[#6a769c]">
          Coey and AI features stay off. You can enable them separately later.
        </p>
        <div className="flex gap-2.5">
          <button type="button" onClick={onCancel} className={BTN_SECONDARY}>Cancel</button>
          <button
            type="button"
            aria-disabled={!canConnect}
            onClick={() => {
              setAttempted(true);
              if (canConnect && chosen) onConnect(chosen.fullName);
            }}
            className={cn(BTN_PRIMARY, !canConnect && "cursor-not-allowed opacity-45")}
          >
            {busy ? "Connecting…" : "Connect repository"}
          </button>
        </div>
        {error ? (
          <Notice tone="bad" live="alert" className="mt-3">
            {error}
          </Notice>
        ) : null}
        <p className="mt-2 text-[12px] text-[#6a769c]" aria-live="polite">
          {canConnect
            ? "Ready to connect."
            : attempted || chosen || acknowledged
              ? "Choose a repository and tick the box above to connect."
              : "Choose a repository and acknowledge sharing to continue."}
        </p>
      </section>
    </div>
  );
}

/** Owner-only: connection details, private-content (AI) consent, and disconnect with confirmation. */
export function ManageDialog({
  open,
  onOpenChange,
  repository,
  consent = false,
  onConsentChange,
  onDisconnect,
  showConsent = true,
  busy = false,
  error = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repository: string;
  consent?: boolean;
  onConsentChange?: (value: boolean) => void;
  onDisconnect: () => void;
  /** Hidden until private-content consent exists (G14). Connecting GitHub never enables AI. */
  showConsent?: boolean;
  busy?: boolean;
  error?: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const consentId = useId();
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage Code Activity</DialogTitle>
            <DialogDescription>Only the List Owner sees this.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-5 text-[13px]">
            <section>
              <h4 className="text-[13px] font-semibold text-[#000533]">Connected repository</h4>
              <p className="mt-1 font-mono text-[13px]">{repository}</p>
              <p className="mt-1 text-[12px] text-[#6a769c]">{SHARING_SENTENCE} You acknowledged this when you connected.</p>
            </section>
            {showConsent ? (
            <section className="rounded-xl border border-[#eaeffa] p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <label htmlFor={consentId} className="text-[13px] font-semibold text-[#000533]">
                    Let Coey read this repository&rsquo;s private content
                  </label>
                  <p className="mt-1 text-[12px] text-[#6a769c]">
                    When on, a change&rsquo;s text and patches are sent to an AI service for summaries and drafts. This is separate from sharing, and
                    it is off until you turn it on. Drafting never turns it on for you.
                  </p>
                </div>
                <Switch id={consentId} checked={consent} onCheckedChange={(value) => onConsentChange?.(value)} aria-label="Private-content processing" />
              </div>
              <p className="mt-2 text-[12px] font-medium text-[#26304f]" aria-live="polite">
                {consent ? "On for this List." : "Off. Drafting and summaries are disabled."}
              </p>
            </section>
            ) : null}
            {error ? (
              <Notice tone="bad" live="alert">
                {error}
              </Notice>
            ) : null}
            <section>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(true)}
                className="inline-flex h-[42px] cursor-pointer items-center rounded-[9px] border border-[#f3b7be] bg-white px-4 text-[14px] font-medium text-[#a61b2b] outline-none hover:bg-[#fdebed] focus-visible:ring-2 focus-visible:ring-[#975ee2]"
              >
                Disconnect repository
              </button>
            </section>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {repository}?</AlertDialogTitle>
            <AlertDialogDescription>
              Saved activity stops being shown to everyone in this List. Things already created from it stay. You can connect again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep connected</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                onOpenChange(false);
                onDisconnect();
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** A connection record exists but no repository is confirmed yet. Nothing is shown beyond that. */
export function ConnectedPanel({
  repository,
  status,
  isOwner,
  onManage,
}: {
  repository: string | null;
  status: "active" | "suspended" | "pending_repository";
  isOwner: boolean;
  onManage: () => void;
}) {
  return (
    <div className="px-5 py-8 lg:px-8 lg:py-10" data-code-activity-state="connected">
      <div className="max-w-2xl rounded-xl border border-[#eaeffa] bg-white p-6 lg:p-8">
        <div className="text-[12px] font-medium tracking-wide text-[#6a769c]">CODE ACTIVITY · READ-ONLY</div>
        <h3 className="mt-1.5 break-all font-mono text-[18px] font-semibold text-[#000533]">{repository ?? "Repository"}</h3>
        <p className="mt-2 text-[13px] text-[#26304f]">
          {status === "suspended"
            ? "The GitHub App is suspended for this repository. Nothing is read until it is unsuspended."
            : "Connected. Everyone in this List can see that this repository is connected."}
        </p>
        <Notice tone="info" className="mt-4">
          <b>The connection is being set up.</b> No activity is shown until a repository is confirmed.
        </Notice>
        {isOwner ? (
          <div className="mt-5">
            <button type="button" onClick={onManage} className={BTN_SECONDARY}>
              Manage
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Owner returned from GitHub but no repository is reachable. Installing or retrying are the only honest actions. */
export function NoRepositoriesPanel({
  busy,
  onInstall,
  onRetry,
  onCancel,
}: {
  busy: boolean;
  onInstall: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="px-5 py-8 lg:px-8 lg:py-10" data-code-activity-state="no-repositories">
      <div className="max-w-2xl rounded-xl border border-[#eaeffa] bg-white p-6 lg:p-8">
        <h3 className="text-[18px] font-semibold text-[#000533]">No repositories are available yet</h3>
        <p className="mt-2 text-[13px] text-[#26304f]">
          Install the Katalist GitHub App on the repository you want, choosing <b>selected repositories</b>, then continue.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" disabled={busy} onClick={onInstall} className={BTN_PRIMARY}>
            Install or manage GitHub access
          </button>
          <button type="button" disabled={busy} onClick={onRetry} className={BTN_SECONDARY}>
            Continue
          </button>
          <button type="button" onClick={onCancel} className={BTN_SECONDARY}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** GitHub access for this repository can no longer be vouched for. Nothing is shown until the owner connects again. */
export function ReverifyPanel({ isOwner, busy, onDisconnect }: { isOwner: boolean; busy: boolean; onDisconnect: () => void }) {
  return (
    <div className="px-5 py-8 lg:px-8 lg:py-10" data-code-activity-state="needs-reverification">
      <div role="status" className="max-w-2xl rounded-xl border border-[#e9d8a6] bg-[#fffaf0] p-6 lg:p-8">
        <h3 className="text-[18px] font-semibold text-[#000533]">GitHub access needs to be verified again</h3>
        <p className="mt-2 text-[13px] text-[#4a3a10]">
          GitHub changed this repository&rsquo;s access in a way Katalist could not fully check. Until it is verified again, nothing
          from the repository is shown and nothing new can be created from it. Your Things are not affected.
        </p>
        {isOwner ? (
          <>
            <p className="mt-3 text-[13px] text-[#4a3a10]">
              Disconnect, then connect again. Connecting asks GitHub and confirms the repository is still reachable.
            </p>
            <button type="button" disabled={busy} onClick={onDisconnect} className={cn(BTN_PRIMARY, "mt-4")}>
              {busy ? "Disconnecting…" : "Disconnect so I can reconnect"}
            </button>
          </>
        ) : (
          <p className="mt-3 text-[13px] text-[#4a3a10]">Ask the List Owner to reconnect it.</p>
        )}
      </div>
    </div>
  );
}
