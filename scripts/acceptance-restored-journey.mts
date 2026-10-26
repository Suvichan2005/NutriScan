import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname));
const status = await (await fetch(`${baseUrl}/api/status`)).json();
assert.equal(typeof status.gemini.enabled, 'boolean');
const output = path.resolve('.data/ideapad-restoration-20261026');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors: string[] = [], remoteRequests: string[] = [], providerRequests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
        remoteRequests.push(url.origin); await route.abort(); return;
      }
      if (['/api/assist', '/api/vision'].includes(url.pathname)) {
        providerRequests.push(url.pathname); await route.abort(); return;
      }
      await route.continue();
    });
    const prefix = viewport.width === 390 ? 'mobile' : 'desktop';
    try {
      await page.goto(baseUrl);
      await page.getByLabel('Understand nutrition and portions', { exact: true }).check();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByText('Details and settings', { exact: true }).click();
      await page.getByText('Advanced analysis settings', { exact: true }).click();
      await page.getByRole('checkbox', { name: /Use local-only analysis in this tab/ }).check();
      await page.getByLabel('What would you like to know?', { exact: true }).fill('How much sodium is in 50 g?');
      await page.getByRole('button', { name: 'Enter label text', exact: true }).click();
      await page.getByLabel('Label text', { exact: true }).fill('Synthetic development label\nServing size 50 g\nNutrition information per 100 g\nEnergy 380 kcal\nSodium 850 mg\nCarbohydrate 60 g\nIngredients: Oats, salt');
      await page.getByRole('button', { name: 'Read label text', exact: true }).click();
      await page.locator('.thread-assistant-message').filter({ hasText: '425 mg sodium' }).waitFor();
      await page.getByLabel('Save chat', { exact: true }).check();
      await page.getByRole('button', { name: /^Open package inspector/ }).click();
      await page.locator('.nutrition-table-disclosure > summary').click();
      await page.getByRole('button', { name: 'Edit Sodium label reading', exact: true }).click();
      await page.getByLabel('Label value', { exact: true }).fill('900');
      await page.getByRole('button', { name: 'Save correction', exact: true }).click();
      const sodium = page.locator('.nutrition-edit-table tr').filter({ has: page.getByRole('rowheader', { name: /Sodium/ }) });
      assert.match(await sodium.innerText(), /450 mg/);
      await page.screenshot({ path: path.join(output, `${prefix}-corrected-inspector.png`) });
      const axe = await new AxeBuilder({ page }).analyze();
      await page.getByRole('button', { name: /^Close package inspector/ }).click();
      await page.getByLabel('Ask about this package', { exact: true }).fill('How much sodium is in 50 g?');
      await page.getByRole('button', { name: 'Send follow-up', exact: true }).click();
      await page.locator('.thread-assistant-message').filter({ hasText: '450 mg sodium' }).waitFor();
      // Read actual persisted data before reloading; do not infer persistence from UI state.
      const saved = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('keyval-store'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        try { return await new Promise<any[]>((resolve, reject) => { const r = db.transaction('keyval').objectStore('keyval').get('nutriscan.history.v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); } finally { db.close(); }
      });
      assert.equal(saved[0].package.nutrients.find((row: any) => row.key === 'sodium').value, 900);
      assert(saved[0].package.observations.some((row: any) => row.text.includes('850')));
      assert(saved[0].package.observations.some((row: any) => row.origin === 'user' && row.supersedesObservationIds?.length));
      assert(!('profile' in saved[0]) && !('images' in saved[0]));
      await page.reload();
      await page.getByRole('button', { name: 'Recent scans', exact: true }).click();
      await page.locator('.history-row').first().click();
      await page.getByLabel('Ask about this package', { exact: true }).fill('How much sodium is in 25 g?');
      await page.getByRole('button', { name: 'Send follow-up', exact: true }).click();
      await page.locator('.thread-assistant-message').filter({ hasText: '225 mg sodium' }).waitFor();
      await page.screenshot({ path: path.join(output, `${prefix}-reopened-followup.png`) });
      assert.equal(await page.locator('.thread-photo-strip img').count(), 0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false);
      assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []); assert.deepEqual(providerRequests, ['/api/assist'], 'The simulated unavailable route must be intercepted before leaving the browser.');
      assert.deepEqual(axe.violations.map(item => item.id), [], `Inspector accessibility regression: ${JSON.stringify(axe.violations.map(item => ({id:item.id,nodes:item.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})))}`);
      outcomes.push({ viewport, correction: '850 → 900 mg/100 g', calculated50g: 450, reopened25g: 225, originalObservationPreserved: true, correctionProvenancePreserved: true, profileAndPhotosExcluded: true, unavailableAssistInterceptedBeforeServer: true, overflow, axeViolations: axe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })), errors, remoteRequests, providerRequests });
    } catch (error) {
      await page.screenshot({ path: path.join(output, `${prefix}-failure.png`) }); throw error;
    } finally { await context.close(); }
  }
  await writeFile(path.join(output, 'restored-journey.json'), JSON.stringify({ scope: 'Synthetic offline UI integration, not photo/provider accuracy', outcomes, passed: true }, null, 2));
  console.log(JSON.stringify({ passed: true, outcomes }));
} finally { await browser.close(); }
