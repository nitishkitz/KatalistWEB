import { useEffect, useId, useMemo, useState } from "react";
import { Eye, EyeOff, Lock, X } from "lucide-react";
import { toast } from "sonner";
import type { QaMember, QaAccount, QaAccountInput, QaGrants, QaListRole } from "../types";
import { QaOperationError } from "../qa-queries";
import { Field, ErrorNotice, inputClass, primaryButton, secondaryButton, textareaClass, iconButton } from "../ui";

const ROLE_LABEL: Record<QaListRole, string> = { owner: "Owners", collaborator: "Collaborators", view_only: "View-only members" };
const ROLES: QaListRole[] = ["owner", "collaborator", "view_only"];
const EMPTY_GRANTS: QaGrants = { useRoles: ["collaborator"], manageRoles: [], useProfiles: [], manageProfiles: [] };

type Props = {
  scopeLabel: string;
  applicationId: string;
  environmentId: string;
  /** Present when editing. Stored secrets are never prefilled. */
  account: QaAccount | null;
  initialGrants: QaGrants | null;
  grantsLoading: boolean;
  members: readonly QaMember[];
  vaultConfigured: boolean;
  preview: boolean;
  saving: boolean;
  error: QaOperationError | null;
  onSave: (input: QaAccountInput) => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

const toggle = <T,>(list: readonly T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function CredentialFormPanel(p: Props) {
  const id = useId();
  const editing = Boolean(p.account);
  const [label, setLabel] = useState(p.account?.label ?? "");
  const [testRole, setTestRole] = useState(p.account?.testRole ?? "");
  const [username, setUsername] = useState(p.account?.username ?? "");
  const [password, setPassword] = useState("");
  const [showTyped, setShowTyped] = useState(false);
  const [instructions, setInstructions] = useState(p.account?.instructions ?? "");
  const [grants, setGrants] = useState<QaGrants>(p.initialGrants ?? EMPTY_GRANTS);
  const [grantsTouched, setGrantsTouched] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // When the stored grants arrive after the panel opened, adopt them unless the member already changed them.
  useEffect(() => {
    if (p.initialGrants && !grantsTouched) setGrants(p.initialGrants);
  }, [p.initialGrants, grantsTouched]);

  const dirty = useMemo(
    () => label !== (p.account?.label ?? "") || testRole !== (p.account?.testRole ?? "") || username !== (p.account?.username ?? "") || password !== "" || instructions !== (p.account?.instructions ?? "") || grantsTouched,
    [label, testRole, username, password, instructions, grantsTouched, p.account],
  );
  useEffect(() => p.onDirtyChange?.(dirty), [dirty, p]);

  const vaultBlocked = !p.vaultConfigured && !p.preview;
  const submit = () => {
    if (!label.trim()) return setValidation("Give the account a name.");
    if (!editing && !password) return setValidation("Enter a password.");
    if (password && vaultBlocked) return setValidation("Protected credential storage is not configured, so a password cannot be saved yet.");
    setValidation(null);
    p.onSave({ id: p.account?.id, applicationId: p.applicationId, environmentId: p.environmentId, label, testRole, username, instructions, password, grants });
  };
  const close = () => (dirty ? setConfirmDiscard(true) : p.onClose());

  return (
    <aside aria-label={editing ? `Edit ${p.account?.label}` : "Add credential"} className="space-y-3.5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="m-0 text-[20px] font-semibold text-[#000533]">{editing ? "Edit credential" : "Add credential"}</h3>
          <p className="mt-0.5 text-[13px] text-[#6a769c]">{p.scopeLabel}</p>
        </div>
        <button type="button" className={iconButton} onClick={close} aria-label="Close credential panel"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>

      {confirmDiscard && (
        <div role="alertdialog" aria-label="Discard changes" className="rounded-lg border border-[#f0e3c4] bg-[#fffaf0] p-3 text-[12.5px]">
          Discard your changes to this credential?
          <div className="mt-2 flex gap-2">
            <button type="button" className={secondaryButton} onClick={() => setConfirmDiscard(false)}>Keep editing</button>
            <button type="button" className={secondaryButton} onClick={p.onClose}>Discard</button>
          </div>
        </div>
      )}

      <Field label="Account name" htmlFor={`${id}-label`}>
        <input id={`${id}-label`} className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} autoComplete="off" />
      </Field>
      <Field label="Test role" htmlFor={`${id}-role`} hint="The role this account has inside the application, for example Dispatcher.">
        <input id={`${id}-role`} className={inputClass} value={testRole} onChange={(e) => setTestRole(e.target.value)} maxLength={80} autoComplete="off" />
      </Field>
      <Field label="Username / email" htmlFor={`${id}-user`}>
        <input id={`${id}-user`} className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} maxLength={320} autoComplete="off" spellCheck={false} />
      </Field>
      <Field label="Password" htmlFor={`${id}-pw`} hint={editing ? "Leave blank to keep the current password. The stored password is never shown here." : undefined}>
        <div className="relative">
          <input
            id={`${id}-pw`}
            className={`${inputClass} pr-10`}
            type={showTyped ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            placeholder={editing ? "Unchanged" : ""}
            maxLength={1024}
            disabled={vaultBlocked}
          />
          <button type="button" className={`${iconButton} absolute right-1 top-0.5`} onClick={() => setShowTyped((v) => !v)} aria-pressed={showTyped} aria-label={showTyped ? "Hide typed password" : "Show typed password"}>
            {showTyped ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </Field>

      <Field label="Storage" htmlFor={`${id}-store`} hint={vaultBlocked ? undefined : "Encrypted storage · permission-controlled access"}>
        <div className="flex h-9 items-center gap-2 rounded-lg border border-[#dfe3f0] bg-[#fafaff] px-2.5 text-[13px]" id={`${id}-store`}>
          <Lock className="h-4 w-4 text-[#975ee2]" aria-hidden="true" /> Project vault
        </div>
        {vaultBlocked && (
          <p role="alert" className="mt-1 rounded-md bg-[#fff8f8] p-2 text-[12px] text-[#c42a3b]">
            Protected credential storage is not configured on this server yet. You can save account details, but a password cannot be stored until it is.
          </p>
        )}
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-[12.5px] font-medium">Access</legend>
        <div className="rounded-lg border border-[#eaeffa] p-2.5">
          <div className="mb-1 text-[12px] font-medium text-[#6a769c]">Can use credentials</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {ROLES.map((r) => (
              <label key={r} className="inline-flex cursor-pointer items-center gap-1.5 text-[13px]">
                <input type="checkbox" checked={grants.useRoles.includes(r)} onChange={() => { setGrantsTouched(true); setGrants((g) => ({ ...g, useRoles: toggle(g.useRoles, r) })); }} /> {ROLE_LABEL[r]}
              </label>
            ))}
          </div>
          <div className="mb-1 mt-2 text-[12px] font-medium text-[#6a769c]">Can manage credentials</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {ROLES.map((r) => (
              <label key={r} className="inline-flex cursor-pointer items-center gap-1.5 text-[13px]">
                <input type="checkbox" checked={grants.manageRoles.includes(r)} onChange={() => { setGrantsTouched(true); setGrants((g) => ({ ...g, manageRoles: toggle(g.manageRoles, r) })); }} /> {ROLE_LABEL[r]}
              </label>
            ))}
          </div>
          {p.members.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[12.5px] text-[#975ee2]">Specific members</summary>
              <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                {p.members.map((m) => (
                  <li key={m.profileId} className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="qa-truncate">{m.name}</span>
                    <span className="flex shrink-0 gap-3">
                      <label className="inline-flex cursor-pointer items-center gap-1"><input type="checkbox" checked={grants.useProfiles.includes(m.profileId)} onChange={() => { setGrantsTouched(true); setGrants((g) => ({ ...g, useProfiles: toggle(g.useProfiles, m.profileId) })); }} aria-label={`${m.name} can use`} /> Use</label>
                      <label className="inline-flex cursor-pointer items-center gap-1"><input type="checkbox" checked={grants.manageProfiles.includes(m.profileId)} onChange={() => { setGrantsTouched(true); setGrants((g) => ({ ...g, manageProfiles: toggle(g.manageProfiles, m.profileId) })); }} aria-label={`${m.name} can manage`} /> Manage</label>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <p className="text-[12px] text-[#6a769c]">Grants only apply to people who are currently members of this List. You always keep manage access to accounts you save.</p>
        {editing && p.grantsLoading && <p className="text-[12px] text-[#6a769c]">Loading current access…</p>}
      </fieldset>

      <Field label="Testing instructions" optional htmlFor={`${id}-ins`} hint="Do not put passwords or tokens here. This text is visible to everyone in the List.">
        <textarea id={`${id}-ins`} className={textareaClass} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={2000} />
      </Field>

      {validation && <p role="alert" className="text-[12.5px] text-[#c42a3b]">{validation}</p>}
      {p.error && <ErrorNotice error={p.error} title="The account was not fully saved" />}

      <div className="grid grid-cols-2 gap-2 pt-1">
        <button type="button" className={secondaryButton} onClick={close}>Cancel</button>
        <button
          type="button"
          className={primaryButton}
          disabled={p.saving}
          onClick={() => {
            submit();
          }}
        >
          {p.saving ? "Saving…" : "Save credential"}
        </button>
      </div>
      {p.preview && <p className="text-center text-[12px] text-[#6a769c]">Example data · preview only</p>}
    </aside>
  );
}

export function notifySaved(secretStored: boolean, hadPassword: boolean) {
  if (hadPassword && !secretStored) toast.warning("Account saved, but no password is stored yet.");
  else toast.success("Credential saved");
}
