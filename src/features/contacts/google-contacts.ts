export const GOOGLE_CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";
type CodeResponse = { code?: string; error?: string };
type GoogleCodeClient = { requestCode(): void };
type GoogleOAuth = {
  initCodeClient(options: {
    client_id: string; scope: string; ux_mode: "popup"; include_granted_scopes: boolean;
    callback: (response: CodeResponse) => void; error_callback: (error: { type: string }) => void;
  }): GoogleCodeClient;
};
declare global { interface Window { google?: { accounts?: { oauth2?: GoogleOAuth } } } }
let loading: Promise<GoogleOAuth> | null = null;

export function googleContactsClientId(): string | undefined {
  return (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_GOOGLE_CONTACTS_CLIENT_ID;
}

export function loadGoogleContactsSdk(): Promise<GoogleOAuth> {
  const oauth = window.google?.accounts?.oauth2;
  if (oauth) return Promise.resolve(oauth);
  if (loading) return loading;
  loading = new Promise<GoogleOAuth>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    const script = existing ?? document.createElement("script");
    let settled = false;
    const finish = (error?: string) => {
      if (settled) return;
      settled = true; window.clearTimeout(timer);
      script.removeEventListener("load", onLoad); script.removeEventListener("error", onError);
      const ready = window.google?.accounts?.oauth2;
      if (error || !ready) {
        if (!existing) script.remove();
        reject(new Error(error ?? "Google Contacts could not load. Try again."));
      } else resolve(ready);
    };
    const onLoad = () => finish();
    const onError = () => finish("Google Contacts could not load. Check your connection.");
    const timer = window.setTimeout(() => finish("Google Contacts took too long to load. Try again."), 15000);
    script.addEventListener("load", onLoad); script.addEventListener("error", onError);
    if (!existing) { script.src = "https://accounts.google.com/gsi/client"; script.async = true; document.head.appendChild(script); }
  }).catch(error => { loading = null; throw error; });
  return loading;
}

// Must be called directly from the click handler, after SDK loading, to keep
// Google's popup within the browser's user-activation window.
export function requestGoogleContactsCode(clientId: string, onCode: (code: string) => void, onError: (message: string) => void) {
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) { onError("Google Contacts is still loading. Try again."); return; }
  oauth.initCodeClient({ client_id: clientId, scope: GOOGLE_CONTACTS_SCOPE, ux_mode: "popup", include_granted_scopes: false,
    callback: response => {
      if (response.code && !response.error) onCode(response.code);
      else onError("Google Contacts access was not granted. Your contacts were kept.");
    },
    error_callback: error => onError(error.type === "popup_closed" ? "Google Contacts sync cancelled." : "Allow the Google popup and try again."),
  }).requestCode();
}
