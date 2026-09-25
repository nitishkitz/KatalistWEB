import { test, expect } from "@playwright/test";

/**
 * T10-07: the plan's five-viewport Morning Brief pass (section 7). Morning
 * Brief only renders behind an authenticated Court route, so this spec
 * signs in via a Demo Persona (`VITE_KATALIST_DEMO_MODE=true` required --
 * see below) rather than a real account.
 *
 * Why this still belongs in `tests/e2e/preview/` under that directory's own
 * "read-only / no sign-in" README: a Demo Persona session
 * (`src/hooks/useSession.ts`'s `signInAsDemo`) is a synthetic `Session`
 * object written to `localStorage` only -- it makes ZERO real Supabase
 * calls to establish, and every subsequent domain action a preview/demo
 * identity takes routes through `src/features/things/local-state.ts`'s
 * in-memory module state (`isPreviewSession()` branches every RPC call site
 * this way), never a real mutation endpoint. The README's actual stated
 * goal -- "safe to run in CI with no real Supabase project at all" -- holds
 * exactly as before: this spec still runs correctly against unreachable
 * fixture Supabase credentials, because it never depends on them resolving.
 * A network assertion below double-checks this directly rather than
 * asserting it only in prose.
 *
 * Requires `VITE_KATALIST_DEMO_MODE=true` in the environment the Playwright
 * webServer is started with (it is NOT this repo's own default -- see
 * `.env.local`/`.env.example`, both `false`) -- e.g.:
 *   VITE_KATALIST_DEMO_MODE=true npx playwright test tests/e2e/preview/morning-brief.spec.ts \
 *     --project=preview-desktop --project=preview-mobile \
 *     --project=preview-tablet-portrait --project=preview-tablet-landscape \
 *     --project=preview-full-hd
 * Every test below skips itself (rather than failing) if the Demo tab isn't
 * present, so a run without that env var reports "skipped", not a false
 * failure, and never silently no-ops as a false pass either.
 */

async function signInAsFirstDemoPersona(page: import("@playwright/test").Page) {
  await page.goto("/auth");
  const demoTab = page.getByRole("button", { name: /^Demo$/i });
  // `.isVisible()` does not auto-wait/retry (unlike `expect().toBeVisible()`)
  // -- the tab bar renders after React hydration, not in the initial HTML,
  // so an immediate check can race a cold-started dev server. `waitFor`
  // actually polls up to its own timeout before giving up.
  const appeared = await demoTab
    .waitFor({ state: "visible", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    return false; // VITE_KATALIST_DEMO_MODE is not enabled for this run
  }
  await demoTab.click();
  const firstPersona = page.getByRole("button", { name: /Priya Sharma/i });
  await expect(firstPersona).toBeVisible();
  await firstPersona.click();
  await page.waitForURL("/");
  return true;
}

test.describe("Morning Brief: real backend isolation", () => {
  test("a Demo Persona session makes no request to a real Supabase RPC endpoint", async ({ page }) => {
    const supabaseRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("supabase.co") || url.includes("/rest/v1/") || url.includes("/rpc/")) {
        supabaseRequests.push(url);
      }
    });

    const signedIn = await signInAsFirstDemoPersona(page);
    test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");

    await page.waitForTimeout(1500); // let Court's own initial renders/queries settle
    expect(supabaseRequests, `unexpected real-backend requests: ${supabaseRequests.join("\n")}`).toEqual([]);
  });
});

// T10-07 finding (pre-existing, not introduced by T10): `src/routes/index.tsx`
// renders `CourtDesktop` (the only component that mounts `useMorningBrief()`/
// `useCatchup()` and renders `CatchUpBanner`/`CatchUpOverlay`) alongside a
// SEPARATE, simpler mobile lane-list UI in an `lg:hidden` block. Below the
// `lg` breakpoint (1024px) that separate mobile block is what's actually
// visible -- `CourtDesktop`'s own rendered output is hidden via CSS at that
// width, taking Morning Brief's only entry point with it. This means Morning
// Brief currently has NO reachable entry point at all on any viewport
// narrower than 1024px (the "preview-mobile" 390px and "preview-tablet-
// portrait" 768px projects below both fall in that range) -- T10-06's mobile
// full-height dialog styling is correct but currently inert there, since
// there is no way to open it. Fixing this is an architecture decision (where
// does a mobile entry point live, and how do the `catchup`/`morningBrief`
// hook results reach both `CourtDesktop` and the separate mobile block)
// beyond this pass's scope; recorded here as a real, reproducible, named
// defect rather than fixed under time pressure.
const LG_BREAKPOINT_PX = 1024;

test.describe("Morning Brief: responsive Court entry point", () => {
  test("at >=lg viewports: Court has no horizontal overflow, and Morning Brief (banner + dialog + Escape) works fully", async ({
    page,
  }, testInfo) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width < LG_BREAKPOINT_PX, "CourtDesktop's Morning Brief entry only renders at >=lg widths");

    const signedIn = await signInAsFirstDemoPersona(page);
    test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");

    // No horizontal scroll/clipping at this viewport (U04).
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow, "Court has horizontal overflow at this viewport").toBe(false);

    await page.screenshot({ path: testInfo.outputPath("court.png"), fullPage: false });

    // The banner is reachable once settled, on every branch (T10-06) -- but
    // this run's actual seeded data determines whether it's the non-empty
    // or "all caught up"/error variant. Either way, "Review" must exist.
    const reviewButton = page.getByRole("button", { name: /^Review( \d+)?$/ });
    await expect(reviewButton).toBeVisible({ timeout: 10_000 });

    await reviewButton.click();
    const dialog = page.getByRole("dialog", { name: /Morning Brief/i });
    await expect(dialog).toBeVisible();

    const dialogOverflow = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(dialogOverflow, "Morning Brief dialog clips its own content horizontally").toBe(false);

    await page.screenshot({ path: testInfo.outputPath("morning-brief-open.png"), fullPage: false });

    // Escape closes and restores focus to a connected element (U02).
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    const active = await page.evaluate(() => document.activeElement?.tagName ?? null);
    expect(active, "focus was not restored anywhere after Escape").not.toBeNull();
  });

  test("below lg: the mobile Court lane list itself has no horizontal overflow (Morning Brief has no entry point here -- see comment above)", async ({
    page,
  }, testInfo) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width >= LG_BREAKPOINT_PX, "covered by the >=lg test above");

    const signedIn = await signInAsFirstDemoPersona(page);
    test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow, "the mobile Court lane list has horizontal overflow at this viewport").toBe(false);
    await page.screenshot({ path: testInfo.outputPath("mobile-court.png"), fullPage: false });

    // Documents the finding as a real, checked assertion rather than a
    // silent skip: Review/Morning Brief is confirmed absent here today.
    await expect(page.getByRole("button", { name: /^Review( \d+)?$/ })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: /Morning Brief/i })).toHaveCount(0);
  });
});
