import { useCallback, useMemo, useRef, useState } from "react";
import { Apple, Box, ChevronDown, ChevronRight, Cpu, Database, ExternalLink, FlaskConical, Globe, Lock, Monitor, Pencil, Play, Plus, Search, Server, Settings, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQaAccess, useQaAccountAccess, useQaAccountGrants, useQaAccounts, useQaBuilds, useQaMutations, useQaResources, useQaVault } from "../use-qa";
import { PLATFORM_LABEL, type PlatformKind, type QaAccount, type QaApplication, type QaAccountInput, type QaEnvironment, type QaMember } from "../types";
import { EmptyNotice, ErrorNotice, SectionTitle, Spinner, formatDateTime, primaryButton, secondaryButton } from "../ui";
import { QaOperationError } from "../qa-queries";
import { CredentialFormPanel, notifySaved } from "./CredentialFormPanel";
import { CredentialTable } from "./CredentialTable";
import { ResourceEditor } from "./ResourceEditor";

const PLATFORM_ICON: Record<PlatformKind, typeof Globe> = { web: Globe, android: Smartphone, ios: Apple, iot: Cpu, api: Server, desktop: Monitor, other: Box };
const envIcon = (name: string) => (/^dev/i.test(name) ? Settings : /^qa/i.test(name) ? Database : /^uat|stag/i.test(name) ? FlaskConical : /^prod/i.test(name) ? Lock : Box);

export type QaScope = { applicationId: string; environmentId: string };

export function AccessWorkspace({
  listId, canManage, members, apps, envs, scope, onScopeChange, onStartRun, onDirtyChange,
}: {
  listId: string;
  canManage: boolean;
  members: readonly QaMember[];
  apps: readonly QaApplication[];
  envs: readonly QaEnvironment[];
  scope: QaScope | null;
  onScopeChange: (scope: QaScope) => void;
  onStartRun: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { api, preview, profileId } = useQaAccess(listId);
  const m = useQaMutations(listId);
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [panel, setPanel] = useState<{ mode: "add" } | { mode: "edit"; account: QaAccount } | null>(null);
  const [setupOpen, setSetupOpen] = useState(true);

  const resources = useQaResources(listId, scope);
  const builds = useQaBuilds(listId, scope);
  const accounts = useQaAccounts(listId, scope);
  const access = useQaAccountAccess(listId);
  const vault = useQaVault(listId);
  const grants = useQaAccountGrants(listId, panel?.mode === "edit" ? panel.account.id : null);

  const term = search.trim().toLowerCase();
  const visibleApps = useMemo(() => apps.filter((a) => !a.archived && (!term || a.name.toLowerCase().includes(term))), [apps, term]);
  const visibleEnvs = useMemo(() => envs.filter((e) => !e.archived && (!term || e.name.toLowerCase().includes(term))), [envs, term]);
  const app = apps.find((a) => a.id === scope?.applicationId);
  const env = envs.find((e) => e.id === scope?.environmentId);
  const currentBuild = builds.data?.[0];
  const setupResource = resources.data?.find((r) => r.type === "setup");

  const draftDirty = useRef(false);
  const trackDirty = useCallback((dirty: boolean) => {
    draftDirty.current = dirty;
    onDirtyChange(dirty);
  }, [onDirtyChange]);
  const closePanel = () => {
    setPanel(null);
    trackDirty(false);
    m.saveAccount.reset();
  };
  const selectScope = (next: QaScope) => {
    if (next.applicationId === scope?.applicationId && next.environmentId === scope?.environmentId) return;
    if (m.saveAccount.isPending) return;
    if (draftDirty.current && !window.confirm("Discard unsaved credential changes?")) return;
    closePanel();
    onScopeChange(next);
  };
  const save = (input: QaAccountInput) =>
    m.saveAccount.mutate(input, {
      onSuccess: (res) => {
        notifySaved(res.secretStored, Boolean(input.password));
        closePanel();
      },
      onError: (e) => {
        if (e instanceof QaOperationError && e.code === "secret_not_stored") void accounts.refetch();
      },
    });

  return (
    <div className="qa-access" data-panel={panel ? "open" : "closed"}>
      <nav className="qa-access-nav" aria-label="Applications and environments">
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#9aa3c0]" aria-hidden="true" />
          <input aria-label="Search resources" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resources..." className="h-9 w-full rounded-lg border border-[#dfe3f0] bg-white pl-8 pr-2 text-[13px] outline-none focus:border-[#975ee2]" />
        </div>
        <div className="mb-1 text-[12.5px] font-medium text-[#6a769c]">Applications</div>
        <ul className="mb-4 space-y-0.5">
          {visibleApps.map((a) => {
            const Icon = PLATFORM_ICON[a.platformKind];
            const active = a.id === scope?.applicationId;
            return (
              <li key={a.id}>
                <button type="button" aria-current={active ? "true" : undefined} disabled={m.saveAccount.isPending} onClick={() => selectScope({ applicationId: a.id, environmentId: scope?.environmentId ?? envs[0]?.id ?? "" })}
                  className={cn("flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] hover:bg-[#fafaff]", active && "bg-[#f3ecfc] font-medium text-[#000533]")}>
                  <Icon className={cn("h-4 w-4 shrink-0", active ? "text-[#975ee2]" : "text-[#6a769c]")} aria-hidden="true" />
                  <span className="qa-truncate flex-1">{a.name}</span>
                  <ChevronRight className="h-4 w-4 text-[#9aa3c0]" aria-hidden="true" />
                </button>
              </li>
            );
          })}
          {visibleApps.length === 0 && <li className="px-2.5 py-2 text-[12.5px] text-[#6a769c]">No applications{term ? " match" : " yet"}.</li>}
        </ul>
        <div className="mb-1 border-t border-[#eef0f6] pt-3 text-[12.5px] font-medium text-[#6a769c]">Environment</div>
        <ul className="space-y-0.5">
          {visibleEnvs.map((e) => {
            const Icon = envIcon(e.name);
            const active = e.id === scope?.environmentId;
            return (
              <li key={e.id}>
                <button type="button" aria-current={active ? "true" : undefined} disabled={m.saveAccount.isPending} onClick={() => selectScope({ applicationId: scope?.applicationId ?? apps[0]?.id ?? "", environmentId: e.id })}
                  className={cn("flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] hover:bg-[#fafaff]", active && "bg-[#f3ecfc] font-medium text-[#000533]")}>
                  <Icon className={cn("h-4 w-4 shrink-0", active ? "text-[#975ee2]" : "text-[#6a769c]")} aria-hidden="true" />
                  <span className="qa-truncate flex-1">{e.name}</span>
                  <ChevronRight className="h-4 w-4 text-[#9aa3c0]" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="qa-access-main">
        {!scope || !app || !env ? (
          <EmptyNotice
            title={apps.length ? "Choose an application and environment" : "No applications yet"}
            body={apps.length ? "Pick a target on the left to see its resources and test accounts." : "Add an application and an environment to start recording where testing happens."}
            action={canManage ? <button type="button" className={primaryButton} onClick={() => setEditorOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Add resources</button> : undefined}
          />
        ) : (
          <>
            <SectionTitle
              title="Environment & access"
              sub="Access the applications, environments and test accounts for this List."
              actions={canManage ? <button type="button" className={secondaryButton} onClick={() => setEditorOpen(true)}><Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit resources</button> : undefined}
            />
            <h3 className="m-0 text-[17px] font-semibold">{app.name} / {env.name}</h3>
            <p className="mb-2 mt-0.5 text-[13px] text-[#6a769c]">
              {currentBuild ? <>Current build {currentBuild.identifier} · Registered {formatDateTime(currentBuild.createdAt)}</> : "No build registered yet"}
              <span className="sr-only"> ({PLATFORM_LABEL[app.platformKind]})</span>
            </p>

            {resources.isLoading ? <Spinner label="Loading resources…" /> : resources.error ? <ErrorNotice error={resources.error} onRetry={() => void resources.refetch()} /> : (
              <div className="qa-scroll mb-5 rounded-lg border border-[#eaeffa]">
                <table className="qa-table" aria-label="Resources">
                  <thead><tr><th scope="col">Type</th><th scope="col">Resource</th><th scope="col">Details</th><th scope="col">Open</th></tr></thead>
                  <tbody>
                    {resources.data?.map((r) => (
                      <tr key={r.id}>
                        <td className="capitalize">{r.type}</td>
                        <td>{r.label}</td>
                        <td className="qa-cell-wrap">{r.details?.split("\n")[0] ?? r.url ?? ""}</td>
                        <td>{r.url ? <a className="inline-flex items-center gap-1 text-[#975ee2] hover:underline" href={r.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open<span className="sr-only"> {r.label} in a new tab</span></a> : <span className="text-[#9aa3c0]">–</span>}</td>
                      </tr>
                    ))}
                    {resources.data?.length === 0 && <tr><td colSpan={4} className="text-[#6a769c]">No resources recorded for {app.name} / {env.name}.{canManage ? " Use Edit resources to add the first one." : ""}</td></tr>}
                  </tbody>
                </table>
              </div>
            )}

            <SectionTitle
              title="Testing accounts"
              sub="Use these accounts to test different permission levels."
              actions={canManage ? <button type="button" className={cn(secondaryButton, "border-[#cdb6ef] text-[#975ee2]")} onClick={() => { m.saveAccount.reset(); setPanel({ mode: "add" }); }}><Plus className="h-4 w-4" aria-hidden="true" /> Add credential</button> : undefined}
            />
            {accounts.isLoading || access.isLoading ? <Spinner label="Loading accounts…" /> : accounts.error ? <ErrorNotice error={accounts.error} onRetry={() => void accounts.refetch()} /> : access.error ? <ErrorNotice error={access.error} onRetry={() => void access.refetch()} /> : accounts.data && accounts.data.length > 0 ? (
              <CredentialTable api={api} accounts={accounts.data} access={access.data ?? []} identityKey={profileId} onEdit={(a) => { m.saveAccount.reset(); setPanel({ mode: "edit", account: a }); }} />
            ) : (
              <EmptyNotice title="No testing accounts" body={canManage ? "Add an account so testers know which login to use." : "No accounts have been added for this target."} />
            )}
            <div className="mt-3 flex items-start gap-3 rounded-lg border border-[#eaeffa] bg-white p-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f3ecfc]"><Lock className="h-4 w-4 text-[#975ee2]" aria-hidden="true" /></span>
              <div className="text-[12.5px]">
                <div className="text-[13.5px] font-medium">Stored in protected vault</div>
                <p className="m-0 text-[#6a769c]">Access is managed separately from List membership. Passwords are encrypted on the server and released only for an explicit copy or reveal.</p>
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-[#eaeffa]">
              <button type="button" className="flex h-11 w-full cursor-pointer items-center gap-2 px-3 text-left text-[14px] font-medium" onClick={() => setSetupOpen((v) => !v)} aria-expanded={setupOpen}>
                {setupOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />} Setup instructions
              </button>
              {setupOpen && (
                <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-3">
                  <ol className="m-0 min-w-0 flex-1 list-decimal space-y-1.5 pl-5 text-[13px] text-[#6a769c]">
                    {(setupResource?.details ?? "").split("\n").filter(Boolean).map((line, i) => <li key={i}>{line}</li>)}
                    {!setupResource?.details && <li className="list-none text-[#9aa3c0]">No setup instructions yet.</li>}
                  </ol>
                  {canManage && <button type="button" className={primaryButton} onClick={onStartRun}><Play className="h-4 w-4" aria-hidden="true" /> Start test run</button>}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {panel && scope && (
        <div className="qa-access-panel">
          <CredentialFormPanel
            key={`${scope.applicationId}:${scope.environmentId}:${panel.mode === "edit" ? panel.account.id : "new"}`}
            scopeLabel={`${app?.name ?? ""} • ${env?.name ?? ""}`}
            applicationId={scope.applicationId}
            environmentId={scope.environmentId}
            account={panel.mode === "edit" ? panel.account : null}
            initialGrants={panel.mode === "edit" ? (grants.data ?? null) : null}
            grantsLoading={panel.mode === "edit" && grants.isLoading}
            members={members}
            vaultConfigured={vault.data !== false}
            preview={preview}
            saving={m.saveAccount.isPending}
            error={m.saveAccount.error instanceof QaOperationError ? m.saveAccount.error : null}
            onSave={save}
            onClose={closePanel}
            onDirtyChange={trackDirty}
          />
        </div>
      )}

      <ResourceEditor listId={listId} open={editorOpen} onOpenChange={setEditorOpen} apps={apps} envs={envs} resources={resources.data ?? []} builds={builds.data ?? []} scope={scope} />
    </div>
  );
}
