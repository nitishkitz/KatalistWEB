import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInPreview } from './demo-sign-in';

test.setTimeout(90_000);
test('Home is differentiated without replacing Court and fits the viewport', async ({page}, info) => {
  await signInPreview(page);
  const context = page.getByRole('group', {name:'Work and Home context'}).filter({visible:true});
  await context.getByRole('button',{name:'Home',exact:true}).click();
  await expect(page.getByRole('region',{name:'Your Home overview'})).toBeVisible();
  await expect(page.locator('[data-app-context="home"]')).toBeVisible();
  await expect(page.locator('[aria-label="Magic Box"]:visible').first()).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('home.png')});
  await context.getByRole('button',{name:'Work',exact:true}).click();
  await expect(page.getByRole('region',{name:'Your Home overview'})).toHaveCount(0);
  await expect(page.locator('[data-app-context="work"]')).toBeVisible();
});

test('Court queue hover preserves reserved card height',async ({page})=>{
  test.skip((page.viewportSize()?.width??0)<1024,'desktop stack only');
  await signInPreview(page);
  const card=page.locator("button[class*='group/queue']:visible").first();
  if(await card.count()===0) throw new Error('Expected populated fixture queue');
  const before=await card.boundingBox();
  await card.hover();
  await expect.poll(async()=>Math.round((await card.boundingBox())!.height)).toBe(Math.round(before!.height));
});

test('Home has no serious automatically detectable accessibility violations',async ({page})=>{
  await signInPreview(page);
  await page.getByRole('group',{name:'Work and Home context'}).filter({visible:true}).getByRole('button',{name:'Home',exact:true}).click();
  await expect(page.getByRole('region',{name:'Your Home overview'})).toBeVisible();
  const results=await new AxeBuilder({page}).analyze();
  expect(results.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
});
