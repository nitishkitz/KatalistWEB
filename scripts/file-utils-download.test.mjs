import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * H03: `downloadFile` was a fire-and-forget `<a>` click -- a dead/expired
 * URL, a CORS failure, or a network error all reported "success" to the
 * caller identically to a real download starting. It must now actually
 * fetch and reject on failure so a caller can show real recovery UI.
 */
const { downloadFile } = await import("@/lib/file-utils");

function installFakeAnchorClick() {
  const clicks = [];
  const realCreateElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const el = realCreateElement(tag);
    if (tag === "a") {
      // Recording the click without invoking the real DOM click -- jsdom
      // doesn't implement navigation and logs noisy (harmless) errors for
      // it, and this test only needs to verify what downloadFile intended
      // to do, not exercise jsdom's own navigation stack.
      el.click = () => {
        clicks.push({ href: el.href, download: el.download });
      };
    }
    return el;
  };
  return { clicks, restore: () => { document.createElement = realCreateElement; } };
}

test("a successful fetch downloads via a blob URL and revokes it afterward", async (t) => {
  const anchor = installFakeAnchorClick();
  t.after(anchor.restore);

  const blob = new Blob(["pdf-bytes"], { type: "application/pdf" });
  mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200, blob: async () => blob }));
  const createdUrls = [];
  const revokedUrls = [];
  const realCreate = URL.createObjectURL.bind(URL);
  const realRevoke = URL.revokeObjectURL.bind(URL);
  mock.method(URL, "createObjectURL", (b) => {
    const u = realCreate(b);
    createdUrls.push(u);
    return u;
  });
  mock.method(URL, "revokeObjectURL", (u) => {
    revokedUrls.push(u);
    return realRevoke(u);
  });
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());

  await downloadFile({ name: "report.pdf", url: "https://storage.example/report.pdf?sig=abc" });

  assert.equal(anchor.clicks.length, 1);
  assert.equal(anchor.clicks[0].download, "report.pdf");
  assert.equal(createdUrls.length, 1);
  mock.timers.tick(1000);
  assert.deepEqual(revokedUrls, createdUrls, "the object URL must be revoked after the anchor click, not leaked");
});

test("a non-2xx response rejects instead of reporting silent success", async () => {
  mock.method(globalThis, "fetch", async () => ({ ok: false, status: 403 }));
  await assert.rejects(
    () => downloadFile({ name: "report.pdf", url: "https://storage.example/report.pdf?sig=expired" }),
    /Download failed \(403\)/,
  );
});

test("a network failure (fetch itself throws) rejects, not silently 'completes'", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
  });
  await assert.rejects(
    () => downloadFile({ name: "report.pdf", url: "https://storage.example/report.pdf" }),
    /network down/,
  );
});

test("a missing URL rejects rather than silently no-op'ing", async () => {
  await assert.rejects(() => downloadFile({ name: "report.pdf" }), /No file URL available/);
});

test("a blob: or data: URL is clicked directly without a network fetch", async (t) => {
  const anchor = installFakeAnchorClick();
  t.after(anchor.restore);
  const fetchSpy = mock.method(globalThis, "fetch", async () => {
    throw new Error("must not be called");
  });

  await downloadFile({ name: "local.png", url: "blob:local-preview" });

  assert.equal(fetchSpy.mock.callCount(), 0, "a local blob URL must never be fetched over the network");
  assert.equal(anchor.clicks.length, 1);
  assert.equal(anchor.clicks[0].href, "blob:local-preview");
});
