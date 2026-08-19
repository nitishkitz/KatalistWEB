import { useEffect, useState, useCallback } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { demoEnabled } from "@/lib/demo-flag";

export interface DemoPersona {
  key: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  initials: string;
  color: string;
}

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    key: "priya",
    name: "Priya Sharma",
    role: "Operations Manager",
    phone: "+919000000001",
    email: "priya.sharma@katalist-demo.test",
    initials: "PS",
    color: "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300",
  },
  {
    key: "arjun",
    name: "Arjun Mehta",
    role: "Product Designer",
    phone: "+919000000002",
    email: "arjun.mehta@katalist-demo.test",
    initials: "AM",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  },
  {
    key: "sarah",
    name: "Sarah Kapoor",
    role: "Marketing Lead",
    phone: "+919000000003",
    email: "sarah.kapoor@katalist-demo.test",
    initials: "SK",
    color: "bg-pink-100 text-pink-700 dark:bg-pink-950/60 dark:text-pink-300",
  },
  {
    key: "mike",
    name: "Mike Fernandes",
    role: "Engineering Lead",
    phone: "+919000000004",
    email: "mike.fernandes@katalist-demo.test",
    initials: "MF",
    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  {
    key: "neha",
    name: "Neha Rao",
    role: "Office Operations",
    phone: "+919000000005",
    email: "neha.rao@katalist-demo.test",
    initials: "NR",
    color: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  },
];

const DEMO_STORAGE_KEY = "katalist_demo_session";
const AUTH_EVENT_NAME = "katalist_auth_state_change";

function createDemoSession(persona: DemoPersona): Session {
  const user: User = {
    id: `demo-${persona.key}`,
    app_metadata: { provider: "demo" },
    user_metadata: {
      display_name: persona.name,
      full_name: persona.name,
      name: persona.name,
      role_label: persona.role,
      initials: persona.initials,
      avatar_color: persona.color,
      phone: persona.phone,
      persona_key: persona.key,
      actor_id: `p-${persona.key}`,
    },
    aud: "authenticated",
    created_at: new Date().toISOString(),
    email: persona.email,
    phone: persona.phone,
    role: "authenticated",
    updated_at: new Date().toISOString(),
  };

  return {
    access_token: `demo-access-token-${persona.key}`,
    refresh_token: `demo-refresh-token-${persona.key}`,
    expires_in: 3600 * 24 * 30,
    expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 30,
    token_type: "bearer",
    user,
  };
}

export function getStoredDemoSession(): Session | null {
  if (typeof window === "undefined") return null;
  if (!demoEnabled()) return null;
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return null;
    const persona: DemoPersona = JSON.parse(raw);
    return createDemoSession(persona);
  } catch {
    return null;
  }
}

export function signInAsDemo(persona: DemoPersona) {
  if (!demoEnabled()) return;
  if (typeof window !== "undefined") {
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(persona));
    window.dispatchEvent(new CustomEvent(AUTH_EVENT_NAME));
  }
}

export async function signOutAll() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(DEMO_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(AUTH_EVENT_NAME));
  }
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.warn("Supabase signOut error:", err);
  }
}

/**
 * Client-side session state. Supports both Supabase Auth sessions
 * and 1-click Demo Persona sessions for instant development/testing.
 */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(() => {
    const demo = getStoredDemoSession();
    if (demo) {
      setSession(demo);
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    let active = true;

    // Listen to Supabase auth events
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      const demo = getStoredDemoSession();
      if (demo) {
        setSession(demo);
      } else {
        setSession(next);
      }
      setLoading(false);
    });

    // Listen to custom demo auth events and cross-tab storage changes
    const handleCustomAuthChange = () => {
      if (!active) return;
      refreshSession();
    };

    window.addEventListener(AUTH_EVENT_NAME, handleCustomAuthChange);
    window.addEventListener("storage", handleCustomAuthChange);

    // Initial check
    refreshSession();

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
      window.removeEventListener(AUTH_EVENT_NAME, handleCustomAuthChange);
      window.removeEventListener("storage", handleCustomAuthChange);
    };
  }, [refreshSession]);

  return {
    session,
    user: session?.user ?? null,
    loading,
    isDemo: session?.user?.app_metadata?.provider === "demo",
    signInAsDemo,
    signOut: signOutAll,
  };
}
