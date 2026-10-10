import { useEffect, useState } from "react";
import { resolveQaEnabled } from "./qa-gate";

/** Resolved after mount so server and first client render agree (the tab is absent), then enabled on the client. */
export function useQaEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(resolveQaEnabled({ development: import.meta.env.DEV, flag: import.meta.env.VITE_QA_ENABLED as string | undefined }));
  }, []);
  return enabled;
}
