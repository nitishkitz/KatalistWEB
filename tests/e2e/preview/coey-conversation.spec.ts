import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInPreview } from "./demo-sign-in";

/**
 * Coey text conversation in a real browser. The assistant API is MOCKED
 * (page.route) with server-shaped SSE frames, so these checks prove the panel,
 * layout and accessibility, not the server. Server behavior is covered by
 * scripts/assistant-*.test.mjs and by the live probe described in
 * output/coey-acceptance/results.md.
 */
const thing = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id, title, list_id: null, status: "not_started", acknowledgement: "none", due_at: null, is_overdue: false,
  assignee_actor_id: null, assignee_name: null, owner_actor_id: null, updated_at: "2026-10-10T00:00:00Z", citation_label: title, ...over,
});
const freshness = { timezone: "Asia/Kolkata", is_partial: false, source_max_updated_at: null };
const emptyFacts = { scope: null, summary: null, things: [], nudge_recommendations: [] };

const RESPONSES: Record<string, { text: string; intent: string }> = {
  "whats up today": { intent: "attention_items", text: "Today: 2 overdue, 1 due today. Start with **Line chart** (overdue); **Pie chart** (overdue)." },
  hi: { intent: "clarification", text: "Hi. What would you like to look at in your Court?" },
  "What needs my attention?": { intent: "attention_items", text: "2 overdue, 1 waiting for a response. Start with **Line chart** (overdue)." },
  "Who needs a nudge?": { intent: "nudge_recommendation", text: "**Ajju** has 2 eligible Things to follow up on." },
  "What is overdue?": { intent: "overdue_items", text: "2 Things overdue. Oldest due date first: **Line chart** (overdue)." },
  "What changed this week?": { intent: "recent_activity", text: "3 changes during the last 7 days." },
};

function frames(turnId: string, text: string, intent: string, withGreetingStatus = false) {
  const f = (seq: number, e: Record<string, unknown>) => `event: ${e.type}\ndata: ${JSON.stringify({ turnId, seq, ...e })}\n\n`;
  const answer = { intent, answer_markdown: text, confidence: "high", citations: [], actions: [], freshness };
  return (
    f(1, { type: "accepted" }) +
    (withGreetingStatus ? "" : f(2, { type: "status", stage: "reading_facts", text: "Checking your Court" })) +
    f(3, { type: "text_delta", text }) +
    f(4, { type: "answer", answer, facts: emptyFacts }) +
    f(5, { type: "completed" })
  );
}

async function mockAssistant(page: Page, opts: { delayMs?: (q: string) => number } = {}) {
  const asked: string[] = [];
  await page.route("**/api/assistant/stream", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { question: string };
    asked.push(body.question);
    const match = RESPONSES[body.question] ?? { intent: "scope_summary", text: `Answer for ${body.question}` };
    await new Promise((r) => setTimeout(r, opts.delayMs?.(body.question) ?? 0));
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
      body: frames(`turn-${asked.length}`, match.text, match.intent, body.question === "hi"),
    });
  });
  return asked;
}

async function ask(page: Page, question: string) {
  const box = page.locator('[aria-label="Magic Box"]:visible').first();
  await page.getByRole("button", { name: "Ask", exact: true }).first().click();
  await box.fill(question);
  await box.press("Enter");
}

test("the six screenshot prompts get real, non-canned answers and the panel stays usable", async ({ page }) => {
  const signedIn = await signInPreview(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");
  await mockAssistant(page);
  const panel = page.getByRole("region", { name: "Magic Box assistant" });
  for (const question of Object.keys(RESPONSES)) {
    await ask(page, question);
    const expected = RESPONSES[question].text.replace(/\*\*/g, "");
    await expect(panel).toContainText(expected.slice(0, 40), { timeout: 10_000 });
    await expect(panel).not.toContainText("I can summarize this scope");
    await expect(panel).not.toContainText("active Things, 0 completed");
    // The panel never covers the whole viewport: the composer remains reachable.
    const viewport = page.viewportSize()!;
    const box = await panel.boundingBox();
    expect(box!.height).toBeLessThan(viewport.height * 0.7);
    await expect(page.locator('[aria-label="Magic Box"]:visible').first()).toBeVisible();
    if (process.env.COEY_EVIDENCE_DIR)
      await page.screenshot({ path: `${process.env.COEY_EVIDENCE_DIR}/text-${test.info().project.name}-${question.replace(/\W+/g, "_")}.png` });
  }
});

test("a greeting shows no status preamble, and a silent server is reported as Connecting, not as checking", async ({ page }) => {
  const signedIn = await signInPreview(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");
  await mockAssistant(page, { delayMs: (q) => (q === "whats up today" ? 1500 : 0) });
  const panel = page.getByRole("region", { name: "Magic Box assistant" });
  await ask(page, "hi");
  await expect(panel).toContainText("Hi. What would you like");
  await expect(panel).not.toContainText("Checking your Court");
  await ask(page, "whats up today");
  await expect(panel.getByText("Connecting")).toBeVisible({ timeout: 4000 });
  await expect(panel).not.toContainText("Checking your Court");
  await expect(panel).toContainText("Today: 2 overdue", { timeout: 10_000 });
});

test("two quick questions end on the last answer; a late first answer never replaces it", async ({ page }) => {
  const signedIn = await signInPreview(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");
  await mockAssistant(page, { delayMs: (q) => (q === "What is overdue?" ? 2500 : 0) });
  const panel = page.getByRole("region", { name: "Magic Box assistant" });
  await ask(page, "What is overdue?");
  await ask(page, "Who needs a nudge?");
  await expect(panel).toContainText("Ajju has 2 eligible Things");
  await page.waitForTimeout(3200);
  await expect(panel).toContainText("Ajju has 2 eligible Things");
  await expect(panel).not.toContainText("2 Things overdue");
});

test("the answer is not rewritten by a timer", async ({ page }) => {
  const signedIn = await signInPreview(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");
  const asked = await mockAssistant(page);
  await ask(page, "hi");
  await expect(page.getByRole("region", { name: "Magic Box assistant" })).toContainText("Hi. What would you like");
  await page.clock.install();
  await page.clock.fastForward(65_000);
  await page.waitForTimeout(300);
  expect(asked).toEqual(["hi"]);
});

test("the open panel has no serious or critical axe violations and is keyboard reachable", async ({ page }) => {
  const signedIn = await signInPreview(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");
  await mockAssistant(page);
  await ask(page, "What needs my attention?");
  const panel = page.getByRole("region", { name: "Magic Box assistant" });
  await expect(panel).toContainText("2 overdue");
  const results = await new AxeBuilder({ page }).include('[aria-label="Magic Box assistant"]').analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad, bad.map((v) => `${v.id}: ${v.description}`).join("\n")).toEqual([]);
  await panel.getByRole("button", { name: "Refresh answer" }).focus();
  await expect(panel.getByRole("button", { name: "Refresh answer" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("button", { name: "Close assistant answer" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel).toHaveCount(0);
});

test("a stream failure shows a clear message and Try again recovers", async ({ page }) => {
  const signedIn = await signInPreview(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");
  let fail = true;
  await page.route("**/api/assistant/stream", async (route) => {
    if (fail) return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ message: "Katalist could not prepare an answer right now." }) });
    return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: frames("t", "Back online.", "scope_summary") });
  });
  await ask(page, "What is overdue?");
  const panel = page.getByRole("region", { name: "Magic Box assistant" });
  await expect(panel.getByRole("alert")).toContainText("could not prepare an answer");
  fail = false;
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(panel).toContainText("Back online.");
});
