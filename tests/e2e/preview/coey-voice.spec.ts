import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signInPreview } from "./demo-sign-in";

/**
 * Coey voice in a real Chromium with a synthetic microphone. The voice
 * SERVER is MOCKED (page.routeWebSocket) and Sarvam is never contacted, so
 * this proves the browser surface: states, captions, mic lifecycle, muting,
 * interruption and typed fallback. It is not evidence about the bridge,
 * Sarvam, or latency. See output/coey-acceptance/results.md.
 */
function tonePcmWav(): string {
  const rate = 48000, seconds = 8;
  const samples = rate * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5 * 32767), 44 + i * 2);
  const file = join(mkdtempSync(join(tmpdir(), "coey-tone-")), "tone.wav");
  writeFileSync(file, buffer);
  return file;
}
const TONE = tonePcmWav();

test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${TONE}`] },
});

const freshness = { timezone: "Asia/Kolkata", is_partial: false, source_max_updated_at: null };

type Probe = { sent: string[]; binary: number; stopped: boolean };

async function setup(page: Page, { enabled = true }: { enabled?: boolean } = {}) {
  await page.addInitScript(() => {
    (window as unknown as { __coeyVoiceTestToken: string }).__coeyVoiceTestToken = "t".repeat(40);
    const w = window as unknown as { __tracks: MediaStreamTrack[] };
    w.__tracks = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const stream = await original(c);
      stream.getTracks().forEach((t) => w.__tracks.push(t));
      return stream;
    };
  });
  await page.route("**/api/assistant/voice-config", (route) => route.fulfill({ json: { enabled } }));
  const probe: Probe = { sent: [], binary: 0, stopped: false };
  await page.routeWebSocket(/\/api\/assistant\/voice$/, (ws) => {
    let answered = false;
    ws.onMessage((message) => {
      if (typeof message !== "string") {
        probe.binary += 1;
        if (probe.binary === 1) ws.send(JSON.stringify({ type: "voice_state", sessionId: "s1", turnId: "t1", state: "listening" }));
        if (probe.binary === 6 && !answered) {
          answered = true;
          const send = (m: unknown) => ws.send(JSON.stringify(m));
          send({ type: "transcript_partial", sessionId: "s1", turnId: "t1", text: "whats up" });
          setTimeout(() => {
            send({ type: "transcript_final", sessionId: "s1", turnId: "t1", text: "whats up today" });
            send({ type: "voice_state", sessionId: "s1", turnId: "t1", state: "checking" });
            send({ type: "coey_event", sessionId: "s1", turnId: "t1", event: { turnId: "t1", seq: 1, type: "accepted" } });
            send({
              type: "coey_event", sessionId: "s1", turnId: "t1",
              event: { turnId: "t1", seq: 2, type: "answer", facts: { scope: null, summary: null, things: [], nudge_recommendations: [] },
                answer: { intent: "attention_items", answer_markdown: "Today: 2 overdue, 1 due today.", confidence: "high", citations: [], actions: [], freshness } },
            });
            send({ type: "coey_event", sessionId: "s1", turnId: "t1", event: { turnId: "t1", seq: 3, type: "completed" } });
            send({ type: "voice_state", sessionId: "s1", turnId: "t1", state: "speaking" });
          }, 400);
        }
        return;
      }
      const parsed = JSON.parse(message) as { type: string };
      probe.sent.push(parsed.type);
      if (parsed.type === "start") ws.send(JSON.stringify({ type: "ack", v: 1, sessionId: "s1" }));
      if (parsed.type === "stop") probe.stopped = true;
      if (parsed.type === "interrupt") ws.send(JSON.stringify({ type: "voice_state", sessionId: "s1", turnId: "t1", state: "idle" }));
    });
  });
  return probe;
}

const tracksEnded = (page: Page) =>
  page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.every((t) => t.readyState === "ended"));

test("the mic is hidden while voice is disabled", async ({ page }) => {
  const signedIn = await signInPreview(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");
  await setup(page, { enabled: false });
  await page.reload();
  await expect(page.locator('[aria-label="Magic Box"]:visible').first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Voice unavailable — details" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Talk to Coey" })).toHaveCount(0);
});

test("a spoken turn shows live states, captions and the answer, and End voice releases the microphone", async ({ page }) => {
  const signedIn = await signInPreview(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");
  const probe = await setup(page);
  await page.reload();
  await page.getByRole("button", { name: "Talk to Coey" }).first().click();
  const voice = page.locator('[data-testid="coey-voice"]:visible').first();
  await expect(voice).toHaveAttribute("data-voice-phase", /connecting|listening/);
  await expect(page.locator('[data-testid="coey-mic-indicator"]:visible').first()).toBeVisible();
  await expect(page.locator('[data-testid="coey-caption"]:visible').first()).toContainText("You: whats up", { timeout: 15_000 });
  await expect(voice).toHaveAttribute("data-voice-phase", "speaking", { timeout: 10_000 });
  const panel = page.getByRole("region", { name: "Magic Box assistant" });
  await expect(panel).toContainText("Today: 2 overdue, 1 due today.");
  await expect(panel.getByText("whats up today").first()).toBeVisible();
  if (process.env.COEY_EVIDENCE_DIR)
    await page.screenshot({ path: `${process.env.COEY_EVIDENCE_DIR}/voice-speaking-${test.info().project.name}.png` });
  // Typed Ask remains operable while voice is live.
  await expect(page.locator('[aria-label="Magic Box"]:visible').first()).toBeEnabled();
  const results = await new AxeBuilder({ page }).include('[data-testid="coey-voice"]').analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  await page.getByRole("button", { name: /End voice/ }).first().click();
  await expect(voice).toHaveAttribute("data-voice-phase", "idle");
  expect(await tracksEnded(page)).toBe(true);
  expect(probe.stopped).toBe(true);
  expect(probe.sent[0]).toBe("start");
});

test("mute stops audio leaving the device and stop-speaking interrupts the server", async ({ page }) => {
  const signedIn = await signInPreview(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");
  const probe = await setup(page);
  await page.reload();
  await page.getByRole("button", { name: "Talk to Coey" }).first().click();
  await expect(page.locator('[data-testid="coey-voice"]:visible').first()).toHaveAttribute("data-voice-phase", "speaking", { timeout: 15_000 });
  await page.getByRole("button", { name: "Stop speaking" }).first().click();
  await expect.poll(() => probe.sent.includes("interrupt")).toBe(true);
  await page.getByRole("button", { name: "Mute" }).first().click();
  await page.waitForTimeout(300);
  const before = probe.binary;
  await page.waitForTimeout(1200);
  expect(probe.binary).toBe(before);
  await expect(page.getByRole("button", { name: "Unmute" }).first()).toHaveAttribute("aria-pressed", "true");
});

test("microphone denial leaves typed Ask working", async ({ page, context }) => {
  const signedIn = await signInPreview(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");
  await setup(page);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("denied", "NotAllowedError"); };
  });
  await context.clearPermissions();
  await page.reload();
  await page.getByRole("button", { name: "Talk to Coey" }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: "Microphone access was blocked" }).first()).toBeVisible();
  const box = page.locator('[aria-label="Magic Box"]:visible').first();
  await box.fill("hello");
  await expect(box).toHaveValue("hello");
});

test("reduced motion removes the pulsing indicator animation", async ({ page }) => {
  const signedIn = await signInPreview(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  await page.reload();
  await page.getByRole("button", { name: "Talk to Coey" }).first().click();
  const dot = page.locator('[data-testid="coey-mic-indicator"]:visible').first();
  await expect(dot).toBeVisible();
  const animation = await dot.evaluate((el) => getComputedStyle(el).animationName);
  expect(animation).toBe("none");
});
