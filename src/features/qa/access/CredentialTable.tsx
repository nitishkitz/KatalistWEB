import { useState } from "react";
import { Check, Copy, Eye, EyeOff, Loader2, Lock, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { QaApi } from "../api-types";
import type { QaAccount, QaAccountAccess } from "../types";
import { iconButton } from "../ui";
import { copyPlainText, useSecretAction } from "./use-secret-action";

function PasswordCell({ api, account, identityKey }: { api: QaApi; account: QaAccount; identityKey: string | undefined }) {
  const { state, reveal, copy } = useSecretAction(api, account.id, identityKey);
  const working = state.kind === "working";
  const shown = state.kind === "revealed";
  return (
    <div className="flex items-center gap-1">
      <span
        className="min-w-[96px] font-mono text-[13px] tracking-wide"
        aria-label={shown ? `Password for ${account.label}` : `Password for ${account.label} is hidden`}
        data-testid={`password-${account.label}`}
      >
        {shown ? state.value : "•••••••••"}
      </span>
      <button type="button" className={iconButton} onClick={reveal} disabled={working} aria-pressed={shown} aria-label={shown ? `Hide password for ${account.label}` : `Reveal password for ${account.label}`}>
        {working && state.action === "reveal" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
      <button type="button" className={cn(iconButton, state.kind === "copied" && "text-[#16803f]")} onClick={copy} disabled={working} aria-label={`Copy password for ${account.label}`}>
        {state.kind === "copied" ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {state.kind === "copied" ? "Password copied" : state.kind === "revealed" ? "Password revealed" : ""}
      </span>
      {state.kind === "clipboard_denied" && (
        <span role="alert" className="max-w-[200px] text-[12px] text-[#b85f0a]">Your browser blocked copying. Use Reveal and copy it manually.</span>
      )}
      {state.kind === "error" && (
        <span role="alert" className="max-w-[220px] text-[12px] text-[#c42a3b]">{state.error.message}</span>
      )}
    </div>
  );
}

function UsernameCell({ account }: { account: QaAccount }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative flex items-center gap-1">
      <span className="[overflow-wrap:anywhere]">
        {account.username ? account.username.split("@").flatMap((part, i) => (i === 0 ? [part] : [<wbr key={i} />, `@${part}`])) : <span className="text-[#9aa3c0]">Not set</span>}
      </span>
      {account.username && (
        <button
          type="button"
          className={cn(iconButton, copied && "text-[#16803f]")}
          aria-label={`Copy username for ${account.label}`}
          onClick={async () => {
            if (await copyPlainText(account.username)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } else toast.error("Your browser blocked copying the username.");
          }}
        >
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        </button>
      )}
      {copied && (
        <span role="status" className="absolute -top-6 left-0 rounded bg-[#000533] px-2 py-0.5 text-[12px] text-white">Copied</span>
      )}
    </div>
  );
}

/** Account rows. Secret controls render only where the server-evaluated access says the member may use them. */
export function CredentialTable({
  api, accounts, access, identityKey, onEdit,
}: {
  api: QaApi;
  accounts: readonly QaAccount[];
  access: readonly QaAccountAccess[];
  identityKey: string | undefined;
  onEdit: (account: QaAccount) => void;
}) {
  const byId = new Map(access.map((a) => [a.accountId, a]));
  return (
    <div className="qa-scroll rounded-lg border border-[#eaeffa]">
      <table className="qa-table" aria-label="Testing accounts">
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Role</th>
            <th scope="col">Username</th>
            <th scope="col">Password</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => {
            const cap = byId.get(a.id) ?? { accountId: a.id, canUse: false, canManage: false };
            return (
              <tr key={a.id}>
                <td className="whitespace-nowrap font-medium">{a.label}</td>
                <td>{a.testRole || <span className="text-[#9aa3c0]">–</span>}</td>
                <td><UsernameCell account={a} /></td>
                <td>
                  {cap.canUse && a.hasSecret ? (
                    <PasswordCell api={api} account={a} identityKey={identityKey} />
                  ) : cap.canUse && !a.hasSecret ? (
                    <span className="text-[12.5px] text-[#b85f0a]">No password stored</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[#6a769c]"><Lock className="h-3.5 w-3.5" aria-hidden="true" /> No access to the password</span>
                  )}
                </td>
                <td>
                  {cap.canManage ? (
                    <button type="button" className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md px-2 text-[13px] font-medium text-[#975ee2] hover:bg-[#f3ecfc]" onClick={() => onEdit(a)} aria-label={`Edit ${a.label}`}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                    </button>
                  ) : (
                    <span className="text-[#9aa3c0]">–</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
