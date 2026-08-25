import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/list-invitations/accept")({
  validateSearch: (search: Record<string, unknown>) => ({ token: typeof search.token === "string" ? search.token : "" }),
  component: AcceptListInvitationPage,
});

function AcceptListInvitationPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [state, setState] = useState("Accepting invite…");
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) { setState("Sign in first, then reopen this invite link."); return; }
      const response = await fetch("/api/list-invitations/accept", { method: "POST", headers: { authorization: `Bearer ${data.session.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ token }) });
      const result = await response.json() as { listId?: string; message?: string };
      if (!response.ok || !result.listId) { setState(result.message ?? "This invite is unavailable or expired."); return; }
      setState("Connected. Opening the List…");
      await navigate({ to: "/lists/$listId", params: { listId: result.listId } });
    })();
  }, [navigate, token]);
  return <AppShell title="List invitation" subtitle="Team connection"><div className="rounded-xl border border-border bg-card p-6 text-[13px]">{state}</div></AppShell>;
}
