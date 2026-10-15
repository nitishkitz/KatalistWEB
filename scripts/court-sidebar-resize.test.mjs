import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

// Run the real pane without Court's network/auth providers. Geometry and
// browser-only APIs are supplied by the test; all resize behavior is production code.
const filename = new URL("../src/features/court/CourtSidebarPane.tsx", import.meta.url).pathname;
const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText;
const mod = new Module(filename);
mod.paths = createRequire(import.meta.url).resolve.paths("react");
mod._compile(compiled, filename);
const { CourtSidebarPane } = mod.exports;

function setup() {
  const dom = new JSDOM('<div id="layout"><div id="root"></div></div>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let width = 1392;
  let wide = true;
  let observer;
  let mediaListener;
  window.matchMedia = () => ({
    get matches() {
      return wide;
    },
    addEventListener: (_, cb) => {
      mediaListener = cb;
    },
    removeEventListener() {},
  });
  globalThis.ResizeObserver = class {
    constructor(cb) {
      observer = cb;
    }
    observe() {}
    disconnect() {}
  };
  document.getElementById("layout").getBoundingClientRect = () => ({
    width,
    right: width,
    left: 0,
  });
  const captured = new Set();
  HTMLElement.prototype.setPointerCapture = (id) => captured.add(id);
  HTMLElement.prototype.hasPointerCapture = (id) => captured.has(id);
  HTMLElement.prototype.releasePointerCapture = (id) => captured.delete(id);
  const root = createRoot(document.getElementById("root"));
  act(() =>
    root.render(
      React.createElement(
        CourtSidebarPane,
        { className: "" },
        React.createElement("p", null, "Sidebar content"),
      ),
    ),
  );
  // The pane measures its immediate flex parent (root in this isolated fixture).
  document.getElementById("root").getBoundingClientRect = () => ({ width, right: width, left: 0 });
  act(() => observer());
  const handle = () => document.querySelector('[role="separator"]');
  const value = () => Number(handle().getAttribute("aria-valuenow"));
  const send = (type, props = {}) =>
    act(() => {
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { pointerId: 1, button: 0, isPrimary: true, clientX: 1000, ...props });
      handle().dispatchEvent(event);
    });
  return {
    handle,
    captured,
    value,
    send,
    resize(next) {
      width = next;
      act(() => observer());
    },
    narrow() {
      wide = false;
      act(() => mediaListener({ matches: false }));
    },
    cleanup() {
      act(() => root.unmount());
      dom.window.close();
    },
  };
}

test("over-dragging stops at both limits and moving back immediately resizes", () => {
  const ui = setup();
  try {
    assert.equal(ui.value(), 340);
    ui.send("pointerdown");
    ui.send("pointermove", { clientX: -10000 });
    assert.equal(ui.value(), 600);
    ui.send("pointermove", { clientX: 1030 });
    assert.equal(ui.value(), 310);
    ui.send("pointermove", { clientX: 10000 });
    assert.equal(ui.value(), 280);
    ui.send("pointerup");
    assert.equal(document.body.style.userSelect, "");
    assert.equal(document.body.style.cursor, "");
  } finally {
    ui.cleanup();
  }
});

test("keyboard limits protect lanes, browser resizing clamps width, reset restores default", () => {
  const ui = setup();
  try {
    ui.resize(1232);
    ui.send("keydown", { key: "End" });
    assert.equal(ui.value(), 496);
    ui.send("keydown", { key: "ArrowRight" });
    assert.equal(ui.value(), 486);
    ui.resize(1120);
    assert.equal(ui.value(), 384);
    ui.send("keydown", { key: "Home" });
    assert.equal(ui.value(), 280);
    ui.send("dblclick");
    assert.equal(ui.value(), 340);
  } finally {
    ui.cleanup();
  }
});

test("cancel and Escape restore the pre-drag size; blur and unmount release drag styles", () => {
  const ui = setup();
  try {
    ui.send("pointerdown");
    ui.send("pointermove", { clientX: 900 });
    assert.equal(ui.value(), 440);
    ui.send("pointercancel");
    assert.equal(ui.value(), 340);
    ui.send("pointerdown");
    ui.send("pointermove", { clientX: 900 });
    ui.send("keydown", { key: "Escape" });
    assert.equal(ui.value(), 340);
    ui.send("pointerdown");
    act(() => window.dispatchEvent(new window.Event("blur")));
    assert.equal(document.body.style.userSelect, "");
    ui.send("pointerdown");
  } finally {
    ui.cleanup();
  }
  assert.equal(document.body.style.userSelect, "");
});

test("secondary pointers cannot change a drag; switching to narrow mode terminates it", () => {
  const ui = setup();
  try {
    ui.send("pointerdown", { button: 2 });
    ui.send("pointermove", { clientX: 900 });
    assert.equal(ui.value(), 340);
    ui.send("pointerdown");
    ui.send("pointermove", { pointerId: 2, clientX: 900 });
    assert.equal(ui.value(), 340);
    ui.narrow();
    assert.equal(document.body.style.userSelect, "");
    assert.equal(ui.captured.size, 0);
    assert.equal(ui.handle().getAttribute("aria-disabled"), "true");
  } finally {
    ui.cleanup();
  }
});
