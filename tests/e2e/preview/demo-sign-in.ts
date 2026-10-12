import { expect, type Page } from '@playwright/test';

export async function signInPreview(page: Page): Promise<boolean> {
  await page.goto('/auth', { waitUntil: 'domcontentloaded' });
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeVisible({ timeout: 30_000 });
  const tab = page.getByRole('button', { name: /^Demo$/i });
  if (await tab.isVisible()) await tab.click();
  const persona = page.getByRole('button', { name: /Priya Sharma/i });
  if (!(await persona.isVisible())) {
    if (process.env.VITE_KATALIST_DEMO_MODE === 'true' || process.env.CI) throw new Error('Expected preview personas are missing; coverage must not skip');
    return false;
  }
  await persona.click();
  await page.waitForURL('/', { timeout: 30_000 });
  await expect(page.locator('[aria-label="Magic Box"]:visible').first()).toBeVisible({ timeout: 30_000 });
  const brief = page.getByRole('dialog').filter({ hasText: 'Morning Brief' });
  if (await brief.isVisible()) await page.keyboard.press('Escape');
  return true;
}
