import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "katalist_sidebar_collapsed";

export function useSidebarCollapse() {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {}
      window.dispatchEvent(new CustomEvent("katalist_sidebar_change", { detail: next }));
      return next;
    });
  }, []);

  useEffect(() => {
    const handleSync = (e: Event) => {
      const customEvent = e as CustomEvent<boolean>;
      if (typeof customEvent.detail === "boolean") {
        setIsCollapsed(customEvent.detail);
      }
    };
    window.addEventListener("katalist_sidebar_change", handleSync);
    return () => window.removeEventListener("katalist_sidebar_change", handleSync);
  }, []);

  return { isCollapsed, toggleCollapsed, setIsCollapsed };
}
