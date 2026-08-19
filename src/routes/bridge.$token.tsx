import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Logo } from "@/components/katalist/Logo";
import { courtFixtures } from "@/features/court/fixtures";
import { toast } from "sonner";

export const Route = createFileRoute("/bridge/$token")({
  component: BridgePage,
});

function BridgePage() {
  const { token } = Route.useParams();
  const thing = courtFixtures[0];
  const [status, setStatus] = useState(thing.workStatus);
  const [caught, setCaught] = useState(false);
  const [comment, setComment] = useState("");
  const [log, setLog] = useState<string[]>([]);

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-lg rounded-2xl border border-border bg-card p-6">
        <Logo />
        <p className="mt-4 text-[11px] font-semibold tracking-wide text-muted-foreground">BRIDGE · THING ONLY</p>
        <h1 className="mt-2 text-xl font-semibold">{thing.title}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          From {thing.owner.name}. You can Catch, update status, comment, and Sort this one Thing.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-[13px]">
          <div>
            <dt className="text-muted-foreground">Due</dt>
            <dd>Today</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Owner Importance</dt>
            <dd className="uppercase">{thing.ownerImportance}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[12px] text-muted-foreground">
          No List access. No other Things. No Personal Pace. No reassignment. Token {token.slice(0, 8)}…
        </p>

        <div className="mt-5 space-y-2">
          {!caught ? (
            <button
              type="button"
              className="h-10 w-full rounded-lg bg-primary text-[13px] font-medium text-primary-foreground"
              onClick={() => {
                setCaught(true);
                toast.success("Caught. Same Thing updated.");
              }}
            >
              Caught It
            </button>
          ) : null}
          <div className="flex gap-2">
            {(["not_started", "under_progress", "sorted"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setStatus(s);
                  toast.success(s === "sorted" ? "Sorted." : "Status updated.");
                }}
                className="flex-1 rounded-lg border border-border py-2 text-[12px]"
              >
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!comment.trim()) return;
              setLog((l) => [...l, comment.trim()]);
              setComment("");
            }}
          >
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="h-9 flex-1 rounded-lg border border-border px-3 text-[13px]"
              placeholder="Comment"
            />
            <button type="submit" className="rounded-lg border border-border px-3 text-[13px]">
              Send
            </button>
          </form>
          {log.map((c) => (
            <p key={c} className="text-[13px]">
              {c}
            </p>
          ))}
          <p className="text-[12px] text-muted-foreground">Current status: {status.replaceAll("_", " ")}</p>
        </div>
      </div>
    </div>
  );
}
