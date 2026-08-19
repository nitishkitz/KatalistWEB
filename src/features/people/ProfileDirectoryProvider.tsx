import type { ReactNode } from "react";
import { ProfileDirectoryContext, useProfileDirectoryQuery } from "./directory";

export function ProfileDirectoryProvider({ children }: { children: ReactNode }) {
  const q = useProfileDirectoryQuery();
  return <ProfileDirectoryContext.Provider value={q.data ?? []}>{children}</ProfileDirectoryContext.Provider>;
}
