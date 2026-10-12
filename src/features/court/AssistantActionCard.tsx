import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { authedFetch } from "@/lib/authed-fetch";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";

export type SuggestedAction = {
  id: string;
  type: string;
  label: string;
  requires_confirmation: boolean;
  target_ids: string[];
  params?: Record<string, unknown>;
};
export type ActionTargetResult = { id: string; title: string; state: string; message?: string };
export type ActionPreview = {
  action: { label: string; reason: string; targetIds: string[]; expiresAt?: string };
  targets: ActionTargetResult[];
  token: string | null;
};

const STATE_TEXT: Record<string, string> = {
  ready: "Ready",
  applied: "Done",
  already_applied: "Already up to date",
  rejected: "Skipped",
  failed: "Failed",
};

async function readJson<T>(response: Response): Promise<T & { message?: string }> {
  // Guard against HTML error pages so a proxy failure never surfaces as a JSON parse error.
  if (!(response.headers.get("content-type") ?? "").includes("json"))
    throw new Error("The assistant returned an unexpected response. Please try again.");
  const body = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(body.message || "That action could not be completed.");
  return body;
}

/** What voice (or any other caller) can do with the same proposal the card shows. */
export type ActionCardHandle = {
  prepare(): Promise<void>;
  confirm(): Promise<void>;
  cancel(): void;
  readonly hasPreview: boolean;
};

export const AssistantActionCard = forwardRef<
  ActionCardHandle,
  {
    action: SuggestedAction;
    onOpenThing: (thingId: string) => void;
    /** Fired when the server preview is ready (token issued), with the preview as shown. */
    onPreview?: (preview: ActionPreview) => void;
    /** Fired with the server's per-target outcome after Confirm. Never before. */
    onResult?: (results: ActionTargetResult[]) => void;
    onError?: (message: string) => void;
  }
>(function AssistantActionCard({ action, onOpenThing, onPreview, onResult, onError }, ref) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [results, setResults] = useState<ActionTargetResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One key per prepared preview: repeated clicks replay the same request.
  const key = useRef<string>("");

  const prepare = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await readJson<ActionPreview>(
        await authedFetch("/api/assistant/action/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: action.type,
            targetIds: action.target_ids,
            params: action.params,
          }),
        }),
      );
      if (!action.requires_confirmation) {
        if (action.type === "open_thing") onOpenThing(action.target_ids[0]);
        else if (action.type === "open_list")
          void navigate({ to: "/lists/$listId", params: { listId: action.target_ids[0] } });
        else
          void navigate({ to: "/buckets/$bucketId", params: { bucketId: action.target_ids[0] } });
        return;
      }
      key.current = crypto.randomUUID();
      setPreview(data);
      onPreview?.(data);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "That action could not be prepared.";
      setError(message);
      onError?.(message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (busy || !preview?.token) return;
    const epoch = getIdentityEpoch(qc).epoch;
    setBusy(true);
    setError(null);
    try {
      const data = await readJson<{ results: ActionTargetResult[] }>(
        await authedFetch("/api/assistant/action/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: preview.token, idempotencyKey: key.current }),
        }),
      );
      if (!isEpochCurrent(qc, epoch)) return;
      setResults(data.results);
      setPreview(null);
      onResult?.(data.results);
      void Promise.all(
        ["assistant", "nudges", "court", "thing", "thing-activity", "list-things", "buckets"].map(
          (name) => qc.invalidateQueries({ queryKey: [name] }),
        ),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "That action could not be completed.";
      setError(message);
      onError?.(message);
    } finally {
      setBusy(false);
    }
  };

  const previewRef = useRef<ActionPreview | null>(null);
  previewRef.current = preview;
  useImperativeHandle(ref, () => ({
    prepare,
    confirm,
    cancel: () => setPreview(null),
    get hasPreview() {
      return Boolean(previewRef.current?.token);
    },
  }));

  const list = (items: ActionTargetResult[]) => (
    <ul className="mt-2 space-y-1 text-xs text-slate-600">
      {items.map((item) => (
        <li key={item.id} className="flex justify-between gap-2">
          <span className="truncate">{item.title}</span>
          <span
            className={
              item.state === "rejected" || item.state === "failed"
                ? "text-red-600"
                : "text-slate-500"
            }
          >
            {STATE_TEXT[item.state] ?? item.state}
            {item.message ? ` · ${item.message}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );

  if (results)
    return (
      <div className="mt-3 rounded-xl border border-slate-200 p-3" role="status">
        <p className="text-xs font-semibold text-slate-800">{action.label}</p>
        {list(results)}
      </div>
    );
  if (preview)
    return (
      <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
        <p className="text-xs font-semibold text-slate-900">
          You are about to: {preview.action.label}.
        </p>
        {list(preview.targets)}
        {error && (
          <p className="mt-2 text-xs text-red-700" role="alert">
            {error}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy || !preview.token}
            onClick={() => void confirm()}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700 focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Confirm
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setPreview(null)}
            className="rounded-lg px-3 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => void prepare()}
        className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50 focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50"
      >
        {busy && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
        {action.label}
      </button>
      {error && (
        <p className="mt-1 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
