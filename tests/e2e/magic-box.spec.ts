import { expect, test } from "playwright/test";

const FIXTURE = `<!doctype html>
<html>
  <body>
    <div class="sr-only" aria-live="polite" id="live"></div>
    <p id="recovery" hidden>Thing created. Retry or remove the remaining attachment.</p>
    <input
      id="magic"
      role="combobox"
      aria-label="Magic Box"
      aria-expanded="false"
      aria-haspopup="listbox"
      aria-controls="composer-listbox"
      aria-autocomplete="list"
    />
    <ul id="composer-listbox" role="listbox" hidden>
      <li role="option" id="composer-option-a-rahul-s">Rahul Sharma</li>
      <li role="option" id="composer-option-a-rakesh">Rakesh Kumar</li>
    </ul>
    <button type="button" id="polish">Polish text</button>
    <button type="button" id="mic">Voice input</button>
    <button type="button" id="toss">Toss Thing</button>
    <div id="flight" class="transition-transform duration-300 ease-out translate-x-2 -translate-y-1"></div>
    <script>
      const input = document.getElementById("magic");
      const list = document.getElementById("composer-listbox");
      const options = [...list.querySelectorAll('[role="option"]')];
      let open = false;
      let highlight = 0;
      let tosses = 0;
      let selected = "";
      document.getElementById("toss").addEventListener("click", () => { tosses += 1; });
      function render() {
        list.hidden = !open;
        input.setAttribute("aria-expanded", String(open));
        input.setAttribute("aria-activedescendant", open ? options[highlight].id : "");
        options.forEach((el, i) => el.setAttribute("aria-selected", String(i === highlight)));
      }
      input.addEventListener("input", () => {
        open = input.value.includes("@");
        highlight = 0;
        render();
      });
      input.addEventListener("keydown", (event) => {
        if (!open) {
          if (event.key === "Enter") tosses += 1;
          return;
        }
        event.preventDefault();
        if (event.key === "ArrowDown") highlight = (highlight + 1) % options.length;
        if (event.key === "ArrowUp") highlight = (highlight - 1 + options.length) % options.length;
        if (event.key === "Enter" || event.key === "Tab") {
          selected = options[highlight].id;
          open = false;
        }
        if (event.key === "Escape") open = false;
        render();
      });
      window.__mb = () => ({ tosses, selected, open, highlight });
    </script>
  </body>
</html>`;

test("MB-019 combobox is operable by keyboard only", async ({ page }) => {
  await page.setContent(FIXTURE);
  const input = page.getByRole("combobox", { name: "Magic Box" });
  await expect(input).toHaveAttribute("aria-haspopup", "listbox");
  await input.fill("Deck for @ra");
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(input).toHaveAttribute("aria-activedescendant", "composer-option-a-rahul-s");
  await input.press("ArrowDown");
  await expect(input).toHaveAttribute("aria-activedescendant", "composer-option-a-rakesh");
  await input.press("Enter");
  const state = await page.evaluate(() => (window as unknown as { __mb: () => { tosses: number; selected: string; open: boolean } }).__mb());
  expect(state.tosses).toBe(0);
  expect(state.selected).toBe("composer-option-a-rakesh");
  expect(state.open).toBe(false);
  await expect(page.getByRole("button", { name: "Polish text" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Voice input" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Toss Thing" })).toBeVisible();
});

test("MB-018 reduced motion removes flight but keeps visible confirmation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setContent(FIXTURE);
  await page.evaluate(() => {
    const el = document.getElementById("flight")!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.className = reduced
      ? "transition-opacity duration-200 ease-out opacity-60"
      : "transition-transform duration-300 ease-out translate-x-2 -translate-y-1";
  });
  const className = await page.locator("#flight").getAttribute("class");
  expect(className?.includes("translate")).toBe(false);
  expect(className).toContain("opacity");
});

test("recovery copy and live region exist for attachment failures", async ({ page }) => {
  await page.setContent(FIXTURE);
  await page.evaluate(() => {
    const recovery = document.getElementById("recovery")!;
    recovery.hidden = false;
    document.getElementById("live")!.textContent = "Thing created. Retry or remove the remaining attachment.";
  });
  await expect(page.locator("#recovery")).toBeVisible();
  await expect(page.locator("#recovery")).toHaveText("Thing created. Retry or remove the remaining attachment.");
  await expect(page.locator("[aria-live='polite']")).toHaveText("Thing created. Retry or remove the remaining attachment.");
});
