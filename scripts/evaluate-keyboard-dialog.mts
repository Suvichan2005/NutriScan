import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Keyboard acceptance only accepts a loopback origin.');
if (!(await fetch(baseUrl, { signal: AbortSignal.timeout(5000) })).ok) throw new Error('NutriScan is unavailable.');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const outcomes: Array<Record<string, unknown>> = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const trigger = page.getByRole('button', { name: 'Add optional context' });
    await trigger.focus();
    const triggerFocusedBeforeOpen = await trigger.evaluate((node) => document.activeElement === node);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Your context, on your terms' });
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    const openedByEnter = await dialog.isVisible();
    const modalSemantics = await dialog.evaluate((node) => node.matches(':modal'));
    const focusInsideOnOpen = await page.evaluate(() => Boolean(document.activeElement?.closest('dialog')));
    const axe = await new AxeBuilder({ page }).analyze();
    let tabStopsInside = 0;
    const tabTrace: Array<{ insideDialog: boolean; tagName: string; id: string }> = [];
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press('Tab');
      const state = await page.evaluate(() => ({ insideDialog: Boolean(document.activeElement?.closest('dialog')), tagName: document.activeElement?.tagName ?? 'NONE', id: (document.activeElement as HTMLElement | null)?.id ?? '' }));
      tabTrace.push(state);
      if (state.insideDialog) tabStopsInside++;
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    const focusRestoredOnClose = await trigger.evaluate((node) => document.activeElement === node);
    const outcome = {
      viewport: `${viewport.width}x${viewport.height}`,
      triggerFocusedBeforeOpen,
      openedByEnter,
      modalSemantics,
      focusInsideOnOpen,
      tabStopsTested: 12,
      tabStopsInside,
      tabTrace,
      escapeClosedDialog: !(await dialog.isVisible()),
      focusRestoredOnClose,
      axeViolationIds: axe.violations.map((violation) => violation.id).sort(),
      pageErrors,
    };
    outcomes.push(outcome);
    console.log(JSON.stringify(outcome));
    await context.close();
  }
  const allViewportsPassed = outcomes.length === 2 && outcomes.every((outcome) => outcome.triggerFocusedBeforeOpen && outcome.openedByEnter && outcome.modalSemantics && outcome.focusInsideOnOpen && outcome.tabStopsInside === 12 && outcome.escapeClosedDialog && outcome.focusRestoredOnClose && Array.isArray(outcome.axeViolationIds) && outcome.axeViolationIds.length === 0 && Array.isArray(outcome.pageErrors) && outcome.pageErrors.length === 0);
  const receipt = { schemaVersion: 1, kind: 'keyboard-native-dialog-browser-acceptance', generatedAt: new Date().toISOString(), origin: 'local loopback', allViewportsPassed, outcomes };
  await writeFile('docs/evidence/keyboard-dialog-browser.json', `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ output: 'docs/evidence/keyboard-dialog-browser.json', allViewportsPassed }));
  if (!allViewportsPassed) process.exitCode = 1;
} finally {
  await browser.close();
}
