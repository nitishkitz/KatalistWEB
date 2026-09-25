import { JSDOM } from "jsdom";

/**
 * Minimal jsdom environment for component-level tests using
 * @testing-library/react, since this project's test runner is plain
 * node:test (no bundler/browser test environment configured). Import
 * this file FIRST, before importing react-dom or @testing-library/react,
 * since they check for `window`/`document` globals at call time.
 */
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });

globalThis.window = dom.window;
globalThis.document = dom.window.document;
// Node has its own built-in `navigator` (a read-only getter) since v21 --
// redefine it instead of assigning, or the assignment throws.
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true, writable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.getComputedStyle = dom.window.getComputedStyle;
// Source modules reference the bare global `localStorage`/`CustomEvent`
// (as in a real browser), not `window.localStorage` -- jsdom only exposes
// these on its own `window`, so code under test would otherwise silently
// no-op (both are wrapped in try/catch for real quota/privacy-mode errors).
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}

// T10/mobile-entry: needed the first time a test in this suite actually
// mounts a real Radix Dialog (CatchUpOverlay, via the new mobile Morning
// Brief entry point) -- @radix-ui/react-focus-scope's focus trap uses a
// real `MutationObserver` in its mount effect, which jsdom implements on
// `window` but Node doesn't expose as a bare global the way a browser
// does. No prior test in this suite rendered a Radix Dialog, so this was
// never needed before.
globalThis.MutationObserver = dom.window.MutationObserver;
// Same focus-trap code walks the DOM with `document.createTreeWalker`,
// which needs the `NodeFilter` constant object (`SHOW_ELEMENT` etc.) --
// also a real global in a browser/jsdom `window`, not in bare Node.
globalThis.NodeFilter = dom.window.NodeFilter;
// ...and does `instanceof HTMLInputElement`/etc checks on the focused
// element to decide whether to auto-select its text -- these element
// constructors are likewise only ever exposed on a browser/jsdom `window`.
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
