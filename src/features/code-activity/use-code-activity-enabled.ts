import { useEffect, useState } from "react";
import { resolveCodeActivityPreview } from "./preview-gate";

/**
 * Whether the Code Activity tab may appear. Local preview only.
 * Resolved after mount so server and first client render agree (the tab is absent), then
 * enabled on the client in development. This hook makes no network request.
 */
export function useCodeActivityEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(
      resolveCodeActivityPreview({
        development: import.meta.env.DEV,
        flag: import.meta.env.VITE_CODE_ACTIVITY_PREVIEW as string | undefined,
      }),
    );
  }, []);
  return enabled;
}
