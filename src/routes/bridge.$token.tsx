import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Logo } from "@/components/katalist/Logo";
import { toast } from "sonner";
import { domainErrorMessage } from "@/lib/domain-error";
import { visibleStatusActions } from "@/features/bridge/visible-status-actions";

export const Route = createFileRoute("/bridge/$token")({
  component: BridgePage,
});

type BridgeThing = {
  id: string;
  title: string;
  owner_name: string;
  owner_importance: "now" | "next" | "later";
  due_at: string | null;
  due_has_time: boolean;
  acknowledgement: string;
  work_status: "not_started" | "under_progress" | "sorted" | "cancelled";
};

function importanceLabel(value: BridgeThing["owner_importance"] | undefined) {
  if (value === "now") return "NOW";
  if (value === "later") return "LATER";
  return "NEXT";
}


function BridgePage() {
  const { token } = Route.useParams();
  const [thing, setThing] = useState<BridgeThing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState("");
  // H08: a client-generated idempotency token, held only while an attempt
  // to send THIS exact text is unresolved -- a manual retry after a failed
  // send reuses it (so a lost-response duplicate is deduped server-side),
  // but editing the text or a successful send clears it, since either one
  // means the next send is a genuinely different logical comment and must
  // get its own fresh token.
  const [pendingCommentToken, setPendingCommentToken] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const redeem = await fetch("/api/public/bridge/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!redeem.ok) throw new Error("This Bridge link isn’t valid anymore.");
        const got = await fetch("/api/public/bridge/thing");
        if (!got.ok) throw new Error("This Bridge link isn’t valid anymore.");
        const payload = (await got.json()) as { thing: BridgeThing };
        if (!cancelled) setThing(payload.thing);
      } catch (err) {
        if (!cancelled) setError(domainErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function act(action: "catch" | "not_started" | "under_progress" | "sorted") {
    setBusy(true);
    try {
      const res = await fetch("/api/public/bridge/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await res.json().catch(() => ({}))) as { work_status?: BridgeThing["work_status"] };
      if (!res.ok) throw new Error("Unable to update this Thing.");
      setThing((t) =>
        t
          ? {
              ...t,
              work_status: payload.work_status ?? (action === "catch" ? t.work_status : action),
              acknowledgement: action === "catch" ? "caught" : t.acknowledgement,
            }
          : t,
      );
      toast.success(action === "sorted" ? "Sorted." : action === "catch" ? "Caught." : "Status updated.");
    } catch (err) {
      toast.error(domainErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendComment() {
    if (!comment.trim()) return;
    const clientToken = pendingCommentToken ?? crypto.randomUUID();
    setPendingCommentToken(clientToken);
    setBusy(true);
    try {
      const res = await fetch("/api/public/bridge/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: comment.trim(), clientToken }),
      });
      if (!res.ok) throw new Error("Unable to update this Thing.");
      setLog((l) => [...l, comment.trim()]);
      setComment("");
      setPendingCommentToken(null);
    } catch (err) {
      // Deliberately keep pendingCommentToken so a manual retry of this
      // same text reuses it -- a lost-response duplicate is then deduped
      // server-side instead of creating a second comment.
      toast.error(domainErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Opening this Thing…</p>
      </div>
    );
  }

  if (error || !thing) {
    return (
      <div className="min-h-screen bg-background px-4 py-10">
        <div className="mx-auto max-w-lg rounded-2xl border border-border bg-card p-6">
          <Logo />
          <h1 className="mt-4 text-xl font-semibold">This Bridge isn’t available</h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            {error ?? "The link may be expired, revoked, or already finished."}
          </p>
        </div>
      </div>
    );
  }

  const caught = thing.acknowledgement === "caught";
  const terminal = thing.work_status === "sorted" || thing.work_status === "cancelled";

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-lg rounded-2xl border border-border bg-card p-6">
        <Logo />
        <p className="mt-4 text-[12px] font-semibold tracking-wide text-muted-foreground">BRIDGE · THING ONLY</p>
        <h1 className="mt-2 text-xl font-semibold">{thing.title}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          From {thing.owner_name}. You can Catch, update status, comment, and Sort this one Thing.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-[13px]">
          <div>
            <dt className="text-muted-foreground">Owner</dt>
            <dd>{thing.owner_name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Owner Importance</dt>
            <dd>{importanceLabel(thing.owner_importance)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Due</dt>
            <dd>{thing.due_at ? new Date(thing.due_at).toLocaleDateString() : "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="capitalize">{thing.work_status.replaceAll("_", " ")}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[12px] text-muted-foreground">
          No List access. No other Things. No Personal Pace. No reassignment.
        </p>

        <div className="mt-5 space-y-2">
          {!caught && !terminal ? (
            <button
              type="button"
              disabled={busy}
              className="h-10 w-full rounded-lg bg-primary text-[13px] font-medium text-primary-foreground disabled:opacity-60"
              onClick={() => void act("catch")}
            >
              Caught It
            </button>
          ) : null}
          {caught && !terminal ? (
            <div className="flex gap-2">
              {/* H03: work status is forward-only on the server (assert_forward_status
               *  rejects a request to go back to "not_started" once work has moved past
               *  it) -- once under_progress, hide "not_started" instead of offering a
               *  button that would always fail with a generic error. */}
              {visibleStatusActions(thing.work_status).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => void act(s)}
                    className="flex-1 rounded-lg border border-border py-2 text-[12px] disabled:opacity-50"
                  >
                    {s.replace("_", " ")}
                  </button>
                ))}
            </div>
          ) : null}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void sendComment();
            }}
          >
            <input
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
                // Editing after a failed send means the next attempt is a
                // different logical comment, not a retry of the old text
                // -- it must get its own fresh token.
                setPendingCommentToken(null);
              }}
              className="h-9 flex-1 rounded-lg border border-border px-3 text-[13px]"
              placeholder="Comment"
            />
            <button type="submit" disabled={busy} className="rounded-lg border border-border px-3 text-[13px]">
              Send
            </button>
          </form>
          {log.map((c) => (
            <p key={c} className="text-[13px]">
              {c}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
