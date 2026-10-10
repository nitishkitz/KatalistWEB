import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { mock, test, afterEach } from "node:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QaOperationError } from "../src/features/qa/qa-queries.ts";
import { useSecretAction, REVEAL_TIMEOUT_MS } from "../src/features/qa/access/use-secret-action.ts";

for (const name of ["Event", "Element", "HTMLElement", "Node", "MutationObserver", "DocumentFragment", "KeyboardEvent", "MouseEvent"]) {
  if (globalThis[name] === undefined && window[name] !== undefined) globalThis[name] = window[name];
}
globalThis.Event = window.Event;
afterEach(() => cleanup());

// Synthetic value only. Never a real credential.
const SECRET = "Synthetic-Test-Value-1";
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};
const fakeApi = (impl) => ({ mode: "live", releaseSecret: impl });
const clipboard = (write) => Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: write }, configurable: true });

test("reveal holds the value only in hook state and clears on window blur", async () => {
  const calls = [];
  const api = fakeApi(async (id, action) => (calls.push([id, action]), SECRET));
  const { result } = renderHook(() => useSecretAction(api, "acc-1", "user-1"));
  await act(() => result.current.reveal());
  assert.equal(result.current.state.kind, "revealed");
  assert.equal(result.current.state.value, SECRET);
  assert.deepEqual(calls, [["acc-1", "reveal"]]);
  await act(async () => window.dispatchEvent(new window.Event("blur")));
  assert.equal(result.current.state.kind, "idle");
  assert.ok(!JSON.stringify(result.current.state).includes(SECRET));
});

test("reveal clears after the timeout", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const api = fakeApi(async () => SECRET);
    const { result } = renderHook(() => useSecretAction(api, "acc-1", "user-1"));
    await act(() => result.current.reveal());
    assert.equal(result.current.state.kind, "revealed");
    await act(async () => mock.timers.tick(REVEAL_TIMEOUT_MS + 1));
    assert.equal(result.current.state.kind, "idle");
  } finally {
    mock.timers.reset();
  }
});

test("switching account or identity clears a revealed value and ignores a late response", async () => {
  const slow = deferred();
  const api = fakeApi((id) => (id === "acc-slow" ? slow.promise : Promise.resolve(SECRET)));
  const { result, rerender } = renderHook(({ id, who }) => useSecretAction(api, id, who), { initialProps: { id: "acc-1", who: "user-1" } });
  await act(() => result.current.reveal());
  assert.equal(result.current.state.kind, "revealed");
  rerender({ id: "acc-2", who: "user-1" });
  assert.equal(result.current.state.kind, "idle");
  await act(() => result.current.reveal());
  rerender({ id: "acc-2", who: "user-2" });
  assert.equal(result.current.state.kind, "idle", "a different signed-in identity never sees the previous value");

  rerender({ id: "acc-slow", who: "user-2" });
  let pending;
  act(() => { pending = result.current.reveal(); });
  rerender({ id: "acc-3", who: "user-2" });
  slow.resolve(SECRET);
  await act(async () => { await pending; });
  assert.equal(result.current.state.kind, "idle", "the late response for the old account is dropped");
});

test("copy writes to the clipboard without ever putting the value in state; success is reported only after the write", async () => {
  const writes = [];
  const write = deferred();
  clipboard((v) => (writes.push(v), write.promise));
  const api = fakeApi(async (_id, action) => (assert.equal(action, "copy"), SECRET));
  const { result } = renderHook(() => useSecretAction(api, "acc-1", "user-1"));
  let pending;
  act(() => { pending = result.current.copy(); });
  await waitFor(() => assert.equal(writes.length, 1));
  assert.equal(writes[0], SECRET);
  assert.notEqual(result.current.state.kind, "copied", "not reported before the clipboard write resolves");
  write.resolve();
  await act(async () => { await pending; });
  assert.equal(result.current.state.kind, "copied");
  assert.ok(!JSON.stringify(result.current.state).includes(SECRET));
});

test("a blocked clipboard offers the manual path instead of claiming success", async () => {
  clipboard(() => Promise.reject(new Error("denied")));
  const api = fakeApi(async () => SECRET);
  const { result } = renderHook(() => useSecretAction(api, "acc-1", "user-1"));
  await act(() => result.current.copy());
  assert.equal(result.current.state.kind, "clipboard_denied");
});

test("denied, revoked and unavailable responses surface as errors and never reveal anything", async () => {
  for (const code of ["forbidden", "not_found", "vault_unavailable", "rate_limited"]) {
    const api = fakeApi(async () => { throw new QaOperationError(code, `server said ${code}`); });
    const { result, unmount } = renderHook(() => useSecretAction(api, "acc-1", "user-1"));
    await act(() => result.current.reveal());
    assert.equal(result.current.state.kind, "error");
    assert.equal(result.current.state.error.code, code);
    unmount();
  }
});


test("blur while reveal or copy is pending discards the response before exposing the secret", async () => {
  for (const action of ["reveal", "copy"]) {
    const slow = deferred();
    const writes = [];
    clipboard(async (v) => writes.push(v));
    const { result, unmount } = renderHook(() => useSecretAction(fakeApi(() => slow.promise), "acc-1", "user-1"));
    let pending;
    act(() => { pending = result.current[action](); });
    await act(async () => window.dispatchEvent(new window.Event("blur")));
    slow.resolve(SECRET);
    await act(async () => { await pending; });
    assert.equal(result.current.state.kind, "idle");
    assert.deepEqual(writes, []);
    unmount();
  }
});
