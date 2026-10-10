import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQaMutations } from "../use-qa";
import { QaOperationError } from "../qa-queries";
import { PLATFORM_KINDS, PLATFORM_LABEL, RESOURCE_TYPES, type PlatformKind, type QaApplication, type QaBuild, type QaEnvironment, type QaResource, type ResourceType } from "../types";
import { Field, inputClass, primaryButton, secondaryButton, dangerButton, textareaClass } from "../ui";

type Tab = "applications" | "environments" | "resources" | "builds";

const fail = (e: unknown) => toast.error(e instanceof QaOperationError ? e.message : "That could not be saved.");

/** Applications, environments, resources and builds for the selected target. Server-enforced for owners and collaborators. */
export function ResourceEditor({
  listId, open, onOpenChange, apps, envs, resources, builds, scope,
}: {
  listId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apps: readonly QaApplication[];
  envs: readonly QaEnvironment[];
  resources: readonly QaResource[];
  builds: readonly QaBuild[];
  scope: { applicationId: string; environmentId: string } | null;
}) {
  const m = useQaMutations(listId);
  const [tab, setTab] = useState<Tab>("resources");
  const tabs: Array<[Tab, string]> = [["applications", "Applications"], ["environments", "Environments"], ["resources", "Resources"], ["builds", "Builds"]];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-qa-root="" className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit resources</DialogTitle>
          <DialogDescription>Applications and environments are shared across the List. Resources and builds belong to the selected application and environment.</DialogDescription>
        </DialogHeader>
        <div role="tablist" aria-label="Resource sections" className="flex gap-1 border-b border-[#eef0f6]">
          {tabs.map(([id, label]) => (
            <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)} className={`h-9 px-3 text-[13px] ${tab === id ? "border-b-2 border-[#975ee2] font-medium text-[#975ee2]" : "text-[#6a769c]"}`}>{label}</button>
          ))}
        </div>
        {tab === "applications" && <ApplicationsTab apps={apps} onSave={(v) => m.upsertApplication.mutate(v, { onError: fail, onSuccess: () => toast.success("Saved") })} />}
        {tab === "environments" && <EnvironmentsTab envs={envs} onSave={(v) => m.upsertEnvironment.mutate(v, { onError: fail, onSuccess: () => toast.success("Saved") })} />}
        {tab === "resources" && (scope ? <ResourcesTab scope={scope} resources={resources} onSave={(v) => m.upsertResource.mutate(v, { onError: fail, onSuccess: () => toast.success("Saved") })} /> : <p className="text-[13px] text-[#6a769c]">Choose an application and environment first.</p>)}
        {tab === "builds" && (scope ? <BuildsTab scope={scope} builds={builds} onRegister={(v, done) => m.registerBuild.mutate(v, { onError: fail, onSuccess: () => { toast.success("Build registered"); done(); } })} /> : <p className="text-[13px] text-[#6a769c]">Choose an application and environment first.</p>)}
      </DialogContent>
    </Dialog>
  );
}

function ApplicationsTab({ apps, onSave }: { apps: readonly QaApplication[]; onSave: (v: { id?: string; name: string; platformKind: PlatformKind; description: string; archived?: boolean }) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PlatformKind>("web");
  const [desc, setDesc] = useState("");
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-[#eef0f6] rounded-lg border border-[#eaeffa]">
        {apps.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
            <span className={a.archived ? "text-[#9aa3c0] line-through" : ""}>{a.name} <span className="text-[#6a769c]">· {PLATFORM_LABEL[a.platformKind]}</span></span>
            <button type="button" className={secondaryButton} onClick={() => onSave({ id: a.id, name: a.name, platformKind: a.platformKind, description: a.description ?? "", archived: !a.archived })}>{a.archived ? "Restore" : "Archive"}</button>
          </li>
        ))}
      </ul>
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onSave({ name, platformKind: kind, description: desc }); setName(""); setDesc(""); } }}>
        <Field label="New application" htmlFor="qa-app-name"><input id="qa-app-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
        <Field label="Platform" htmlFor="qa-app-kind">
          <select id="qa-app-kind" className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as PlatformKind)}>{PLATFORM_KINDS.map((k) => <option key={k} value={k}>{PLATFORM_LABEL[k]}</option>)}</select>
        </Field>
        <div className="sm:col-span-2"><Field label="Description" optional htmlFor="qa-app-desc"><input id="qa-app-desc" className={inputClass} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={2000} /></Field></div>
        <div className="sm:col-span-2"><button className={primaryButton} type="submit" disabled={!name.trim()}>Add application</button></div>
      </form>
    </div>
  );
}

function EnvironmentsTab({ envs, onSave }: { envs: readonly QaEnvironment[]; onSave: (v: { id?: string; name: string; restricted: boolean; archived?: boolean }) => void }) {
  const [name, setName] = useState("");
  const [restricted, setRestricted] = useState(false);
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-[#eef0f6] rounded-lg border border-[#eaeffa]">
        {envs.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
            <span className={e.archived ? "text-[#9aa3c0] line-through" : ""}>{e.name}{e.restricted && <span className="text-[#6a769c]"> · restricted</span>}</span>
            <button type="button" className={secondaryButton} onClick={() => onSave({ id: e.id, name: e.name, restricted: e.restricted, archived: !e.archived })}>{e.archived ? "Restore" : "Archive"}</button>
          </li>
        ))}
      </ul>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onSave({ name, restricted }); setName(""); setRestricted(false); } }}>
        <Field label="New environment" htmlFor="qa-env-name"><input id="qa-env-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} /> Restricted (for example production)</label>
        <button className={primaryButton} type="submit" disabled={!name.trim()}>Add environment</button>
      </form>
    </div>
  );
}

function ResourcesTab({ scope, resources, onSave }: { scope: { applicationId: string; environmentId: string }; resources: readonly QaResource[]; onSave: (v: { id?: string; applicationId: string; environmentId: string; type: ResourceType; label: string; url: string; details: string; archived?: boolean }) => void }) {
  const [type, setType] = useState<ResourceType>("application");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [details, setDetails] = useState("");
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-[#eef0f6] rounded-lg border border-[#eaeffa]">
        {resources.length === 0 && <li className="px-3 py-3 text-[13px] text-[#6a769c]">No resources for this target yet.</li>}
        {resources.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
            <span className="min-w-0"><span className="font-medium">{r.label}</span> <span className="text-[#6a769c]">· {r.type}</span>{r.url && <span className="qa-truncate block text-[12px] text-[#6a769c]">{r.url}</span>}</span>
            <button type="button" className={dangerButton} onClick={() => onSave({ id: r.id, applicationId: r.applicationId, environmentId: r.environmentId, type: r.type, label: r.label, url: r.url ?? "", details: r.details ?? "", archived: true })}>Remove</button>
          </li>
        ))}
      </ul>
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (label.trim()) { onSave({ ...scope, type, label, url, details }); setLabel(""); setUrl(""); setDetails(""); } }}>
        <Field label="Type" htmlFor="qa-res-type"><select id="qa-res-type" className={inputClass} value={type} onChange={(e) => setType(e.target.value as ResourceType)}>{RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
        <Field label="Label" htmlFor="qa-res-label"><input id="qa-res-label" className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={160} /></Field>
        <div className="sm:col-span-2"><Field label="Link" optional htmlFor="qa-res-url" hint="A full https link."><input id="qa-res-url" className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" /></Field></div>
        <div className="sm:col-span-2"><Field label="Details or setup instructions" optional htmlFor="qa-res-details"><textarea id="qa-res-details" className={textareaClass} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={8000} /></Field></div>
        <div className="sm:col-span-2"><button className={primaryButton} type="submit" disabled={!label.trim()}>Add resource</button></div>
      </form>
    </div>
  );
}

function BuildsTab({ scope, builds, onRegister }: { scope: { applicationId: string; environmentId: string }; builds: readonly QaBuild[]; onRegister: (v: { applicationId: string; environmentId: string; identifier: string; displayVersion: string; notesUrl: string; installUrl: string; config: Record<string, string> }, done: () => void) => void }) {
  const [identifier, setIdentifier] = useState("");
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [install, setInstall] = useState("");
  const [model, setModel] = useState("");
  const [os, setOs] = useState("");
  const [firmware, setFirmware] = useState("");
  const reset = () => { setIdentifier(""); setVersion(""); setNotes(""); setInstall(""); setModel(""); setOs(""); setFirmware(""); };
  const config = Object.fromEntries(Object.entries({ model, os, firmware }).filter(([, v]) => v.trim()));
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-[#6a769c]">Builds are immutable. Register a new identifier for each build; an existing identifier is never changed.</p>
      <ul className="divide-y divide-[#eef0f6] rounded-lg border border-[#eaeffa]">
        {builds.length === 0 && <li className="px-3 py-3 text-[13px] text-[#6a769c]">No builds registered for this target yet.</li>}
        {builds.map((b) => <li key={b.id} className="px-3 py-2 text-[13px]"><span className="font-medium">{b.identifier}</span>{b.displayVersion && <span className="text-[#6a769c]"> · {b.displayVersion}</span>}</li>)}
      </ul>
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (identifier.trim()) onRegister({ ...scope, identifier, displayVersion: version, notesUrl: notes, installUrl: install, config }, reset); }}>
        <Field label="Build identifier" htmlFor="qa-b-id" hint="For example web.143"><input id="qa-b-id" className={inputClass} value={identifier} onChange={(e) => setIdentifier(e.target.value)} maxLength={80} /></Field>
        <Field label="Display version" optional htmlFor="qa-b-ver"><input id="qa-b-ver" className={inputClass} value={version} onChange={(e) => setVersion(e.target.value)} /></Field>
        <Field label="Release notes link" optional htmlFor="qa-b-notes"><input id="qa-b-notes" className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} inputMode="url" /></Field>
        <Field label="Install link" optional htmlFor="qa-b-install"><input id="qa-b-install" className={inputClass} value={install} onChange={(e) => setInstall(e.target.value)} inputMode="url" /></Field>
        <Field label="Device model" optional htmlFor="qa-b-model"><input id="qa-b-model" className={inputClass} value={model} onChange={(e) => setModel(e.target.value)} /></Field>
        <Field label="OS" optional htmlFor="qa-b-os"><input id="qa-b-os" className={inputClass} value={os} onChange={(e) => setOs(e.target.value)} /></Field>
        <Field label="Firmware" optional htmlFor="qa-b-fw"><input id="qa-b-fw" className={inputClass} value={firmware} onChange={(e) => setFirmware(e.target.value)} /></Field>
        <div className="sm:col-span-2"><button className={primaryButton} type="submit" disabled={!identifier.trim()}>Register build</button></div>
      </form>
    </div>
  );
}
