import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/team-invitations/accept")({ validateSearch: (search: Record<string, unknown>) => ({ token: typeof search.token === "string" ? search.token : "" }), component: AcceptTeamInvitationPage });
function AcceptTeamInvitationPage() {
  const { token } = Route.useSearch(); const navigate = useNavigate(); const queryClient = useQueryClient(); const [state,setState]=useState("Accepting Team invite…");
  useEffect(() => { void (async () => { const { data }=await supabase.auth.getSession(); if(!data.session?.access_token){setState("Sign in first, then reopen this invite link.");return;} const response=await fetch("/api/team/invitations/accept",{method:"POST",headers:{authorization:`Bearer ${data.session.access_token}`,"content-type":"application/json"},body:JSON.stringify({token})}); if(!response.ok){const result=await response.json() as {message?:string};setState(result.message??"This Team invite is unavailable.");return;} await Promise.all(["team-directory", "team-requests", "assignable-people", "profile-directory"].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))); setState("Connected. Opening your Team…"); await navigate({to:"/team"}); })(); },[navigate,queryClient,token]);
  return <AppShell title="Team invitation" subtitle="Mutual connection" showMagicBox={false}><div className="rounded-xl border border-border bg-card p-6 text-[13px]">{state}</div></AppShell>;
}
