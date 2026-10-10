import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { newIdempotencyKey } from "../domain";
import { QaOperationError } from "../qa-queries";
import { useQaBuilds, useQaCases, useQaMutations } from "../use-qa";
import { DEFAULT_CASE_FILTER, type PlatformKind, type QaApplication, type QaEnvironment, type QaMember, type QaRun } from "../types";
import { ErrorNotice, Field, iconButton, inputClass, primaryButton, secondaryButton } from "../ui";

const CONFIG_FIELDS: Record<PlatformKind, Array<[string, string]>> = {
  web: [["browser", "Browser"], ["os", "OS"]],
  android: [["device", "Device model"], ["os", "Android version"]],
  ios: [["device", "Device model"], ["os", "iOS version"]],
  iot: [["device", "Device model"], ["firmware", "Firmware"], ["connectivity", "Connectivity"]],
  api: [["client", "Client"]],
  desktop: [["os", "OS"]],
  other: [["device", "Device or setup"]],
};

/**
 * New run: binds execution to an application, environment and an immutable build, with the device or
 * browser configuration, the case versions to test and the people assigned. Submitting snapshots the
 * current version of every selected case before anything is executed.
 */
export function RunFormPanel({
  listId, apps, envs, members, defaultScope, preselected, onCancel, onCreated, onDirtyChange,
}: {
  listId: string;
  apps: readonly QaApplication[];
  envs: readonly QaEnvironment[];
  members: readonly QaMember[];
  defaultScope: { applicationId: string; environmentId: string } | null;
  preselected: readonly string[];
  onCancel: () => void;
  onCreated: (run: QaRun) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const id = useId();
  const m = useQaMutations(listId);
  const activeApps = apps.filter((a) => !a.archived);
  const activeEnvs = envs.filter((e) => !e.archived);
  const [name, setName] = useState("");
  const [appId, setAppId] = useState(defaultScope?.applicationId ?? activeApps[0]?.id ?? "");
  const [envId, setEnvId] = useState(defaultScope?.environmentId ?? activeEnvs[0]?.id ?? "");
  const [buildId, setBuildId] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [tester, setTester] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set(preselected));
  const [caseSearch, setCaseSearch] = useState("");
  const [newBuild, setNewBuild] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  // One key per form instance: a double click or retry after a lost response cannot create a second run.
  const idempotencyKey = useRef(newIdempotencyKey("run"));

  const app = apps.find((a) => a.id === appId);
  const builds = useQaBuilds(listId, appId && envId ? { applicationId: appId, environmentId: envId } : null);
  const cases = useQaCases(listId, DEFAULT_CASE_FILTER);
  const visibleCases = useMemo(() => {
    const t = caseSearch.trim().toLowerCase();
    return cases.items.filter((c) => !t || `${c.caseKey} ${c.title}`.toLowerCase().includes(t));
  }, [cases.items, caseSearch]);

  // The default build is the newest one for the chosen target; a build from another target is never kept.
  useEffect(() => {
    if (!builds.data) return;
    if (!builds.data.some((b) => b.id === buildId)) setBuildId(builds.data[0]?.id ?? "");
  }, [builds.data, buildId]);
  useEffect(() => onDirtyChange(Boolean(name || chosen.size !== preselected.length)), [name, chosen, preselected.length, onDirtyChange]);

  const build = builds.data?.find((b) => b.id === buildId);
  const effectiveName = name.trim() || (build ? `${app?.name ?? "Run"} ${build.identifier}` : "");
  const fields = CONFIG_FIELDS[app?.platformKind ?? "web"];
  const toggle = (cid: string) => setChosen((s) => { const n = new Set(s); if (n.has(cid)) n.delete(cid); else n.add(cid); return n; });

  const submit = () => {
    if (!appId || !envId) return setValidation("Choose an application and environment.");
    if (!buildId) return setValidation("Choose a build. A run is always tied to one build.");
    if (chosen.size === 0) return setValidation("Select at least one test case.");
    if (!effectiveName) return setValidation("Name the run.");
    setValidation(null);
    const cleanConfig = Object.fromEntries(Object.entries({ ...build?.config, ...config }).filter(([, v]) => v && v.trim()));
    m.createRun.mutate(
      { name: effectiveName, applicationId: appId, environmentId: envId, buildId, config: cleanConfig, caseIds: [...chosen], assignments: tester ? Object.fromEntries([...chosen].map((c) => [c, tester])) : {}, idempotencyKey: idempotencyKey.current },
      { onSuccess: (run) => { toast.success("Run started"); onCreated(run); } },
    );
  };

  return (
    <aside aria-label="New run" className="space-y-3 p-4">
      <div className="flex items-start justify-between">
        <h3 className="m-0 text-[20px] font-semibold">New run</h3>
        <button type="button" className={iconButton} onClick={onCancel} aria-label="Close new run panel"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <Field label="Run name" htmlFor={`${id}-name`}><input id={`${id}-name`} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={effectiveName || "Release regression"} maxLength={160} /></Field>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Application" htmlFor={`${id}-app`}>
          <select id={`${id}-app`} className={inputClass} value={appId} onChange={(e) => { setAppId(e.target.value); setConfig({}); }}>{activeApps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </Field>
        <Field label="Environment" htmlFor={`${id}-env`}>
          <select id={`${id}-env`} className={inputClass} value={envId} onChange={(e) => setEnvId(e.target.value)}>{activeEnvs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
        </Field>
      </div>
      <Field label="Build" htmlFor={`${id}-build`} hint="Results are recorded against this build and it cannot be changed afterwards.">
        <select id={`${id}-build`} className={inputClass} value={buildId} onChange={(e) => setBuildId(e.target.value)} disabled={!builds.data?.length}>
          {!builds.data?.length && <option value="">No builds registered</option>}
          {builds.data?.map((b) => <option key={b.id} value={b.id}>{b.identifier}{b.displayVersion ? ` · ${b.displayVersion}` : ""}</option>)}
        </select>
        <div className="mt-1.5 flex gap-1.5">
          <input aria-label="Register a new build identifier" className={inputClass} placeholder="Register build, e.g. web.143" value={newBuild} onChange={(e) => setNewBuild(e.target.value)} maxLength={80} />
          <button type="button" className={secondaryButton} disabled={!newBuild.trim() || !appId || !envId || m.registerBuild.isPending}
            onClick={() => m.registerBuild.mutate({ applicationId: appId, environmentId: envId, identifier: newBuild, displayVersion: "", notesUrl: "", installUrl: "", config: {} }, { onSuccess: (b) => { setBuildId(b.id); setNewBuild(""); toast.success(`Build ${b.identifier} registered`); }, onError: (e) => toast.error(e instanceof QaOperationError ? e.message : "The build could not be registered.") })}>Add</button>
        </div>
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map(([key, label]) => (
          <Field key={key} label={label} htmlFor={`${id}-${key}`} optional>
            <input id={`${id}-${key}`} className={inputClass} value={config[key] ?? build?.config[key] ?? ""} onChange={(e) => setConfig((c) => ({ ...c, [key]: e.target.value }))} maxLength={80} />
          </Field>
        ))}
      </div>
      <Field label="Assigned tester" htmlFor={`${id}-tester`} optional>
        <select id={`${id}-tester`} className={inputClass} value={tester} onChange={(e) => setTester(e.target.value)}>
          <option value="">Unassigned</option>{members.map((mm) => <option key={mm.profileId} value={mm.profileId}>{mm.name}</option>)}
        </select>
      </Field>
      <fieldset>
        <legend className="mb-1 flex w-full items-center justify-between text-[12.5px] font-medium">
          <span>Test cases <span className="font-normal text-[#6a769c]">· {chosen.size} selected</span></span>
          <span className="flex gap-2 text-[12px] font-normal text-[#975ee2]">
            <button type="button" className="cursor-pointer underline" onClick={() => setChosen(new Set(visibleCases.map((c) => c.id)))}>Select shown</button>
            <button type="button" className="cursor-pointer underline" onClick={() => setChosen(new Set())}>Clear</button>
          </span>
        </legend>
        <input aria-label="Filter cases" className={`${inputClass} mb-1.5`} placeholder="Filter cases…" value={caseSearch} onChange={(e) => setCaseSearch(e.target.value)} />
        <ul className="m-0 max-h-44 list-none space-y-0.5 overflow-y-auto rounded-lg border border-[#eaeffa] p-1.5">
          {visibleCases.map((c) => (
            <li key={c.id}><label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-[#fafaff]"><input type="checkbox" checked={chosen.has(c.id)} onChange={() => toggle(c.id)} /> <span className="text-[#975ee2]">{c.caseKey}</span> <span className="qa-truncate">{c.title}</span></label></li>
          ))}
          {cases.isLoading && <li className="p-2 text-[12.5px] text-[#6a769c]">Loading cases…</li>}
          {!cases.isLoading && visibleCases.length === 0 && <li className="p-2 text-[12.5px] text-[#6a769c]">No cases. Add some in Test Sheet first.</li>}
        </ul>
        {cases.hasNextPage && <button type="button" className="mt-1 cursor-pointer text-[12.5px] text-[#975ee2] underline" onClick={() => void cases.fetchNextPage()}>Load more cases</button>}
        <p className="mt-1 text-[12px] text-[#6a769c]">The run uses each case's current version at the moment you start it. Later edits do not change it.</p>
      </fieldset>
      {validation && <p role="alert" className="text-[12.5px] text-[#c42a3b]">{validation}</p>}
      {m.createRun.error instanceof QaOperationError && <ErrorNotice error={m.createRun.error} title="The run was not started" />}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={secondaryButton} onClick={onCancel}>Cancel</button>
        <button type="button" className={primaryButton} disabled={m.createRun.isPending} onClick={submit}>{m.createRun.isPending ? "Starting…" : "Start run"}</button>
      </div>
    </aside>
  );
}
