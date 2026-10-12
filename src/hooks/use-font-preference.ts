import { useSyncExternalStore } from "react";

export const FONT_PREFERENCE_KEY = "katalist.ui_font";
export const DEFAULT_FONT = "poppins" as const;

export const FONT_OPTIONS = [
  { id: "poppins", label: "Poppins", detail: "Current default", stack: '"Poppins", ui-sans-serif, system-ui, sans-serif' },
  { id: "roboto", label: "Roboto", detail: "Clean and familiar", stack: '"Roboto", ui-sans-serif, system-ui, sans-serif' },
  { id: "inter", label: "Inter", detail: "Crisp and compact", stack: '"Inter", ui-sans-serif, system-ui, sans-serif' },
  { id: "system", label: "San Francisco", detail: "Apple system font; system font elsewhere", stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { id: "work-sans", label: "Work Sans", detail: "Open and readable", stack: '"Work Sans", ui-sans-serif, system-ui, sans-serif' },
  { id: "mona-sans", label: "Mona Sans", detail: "Modern and expressive", stack: '"Mona Sans", ui-sans-serif, system-ui, sans-serif' },
] as const;

export type FontPreference = (typeof FONT_OPTIONS)[number]["id"];

const EVENT = "katalist-font-preference-change";
let memoryPreference: FontPreference | null = null;
const isFontPreference = (value: string | null): value is FontPreference =>
  FONT_OPTIONS.some((option) => option.id === value);

export function readFontPreference(): FontPreference {
  if (typeof window === "undefined") return DEFAULT_FONT;
  try {
    const stored = window.localStorage.getItem(FONT_PREFERENCE_KEY);
    return isFontPreference(stored) ? stored : DEFAULT_FONT;
  } catch {
    return memoryPreference ?? DEFAULT_FONT;
  }
}

export function applyFontPreference(font: FontPreference): void {
  if (typeof document === "undefined") return;
  if (font === DEFAULT_FONT) delete document.documentElement.dataset.katalistFont;
  else document.documentElement.dataset.katalistFont = font;
}

export function setFontPreference(font: FontPreference): void {
  if (typeof window === "undefined") return;
  try {
    if (font === DEFAULT_FONT) window.localStorage.removeItem(FONT_PREFERENCE_KEY);
    else window.localStorage.setItem(FONT_PREFERENCE_KEY, font);
    memoryPreference = null;
  } catch {
    memoryPreference = font;
  }
  applyFontPreference(font);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function useStoredFontPreference(): FontPreference {
  return useSyncExternalStore(subscribe, readFontPreference, () => DEFAULT_FONT);
}
