import AxeBuilder from '@axe-core/playwright';
import { chromium, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3400';
const origin = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Keyboard acceptance accepts loopback origins only.');
const response = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error(`NutriScan is unavailable: HTTP ${response.status}.`);

type FocusInfo = { key: string; tag: string; name: string; inOpenDialog: boolean } | null;
async function activeFocus(page: Page): Promise<FocusInfo> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || element === document.body || element === document.documentElement) return null;
    const labels = 'labels' in element && element.labels ? Array.from(element.labels).map((label) => label.innerText.trim()).filter(Boolean).join(' ') : '';
    const name = element.getAttribute('aria-label') || labels || element.innerText?.trim() || element.getAttribute('placeholder') || element.getAttribute('title') || element.getAttribute('name') || '';
    const tabbableSelector = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
    const tabbables = Array.from(document.querySelectorAll<HTMLElement>(tabbableSelector)).filter((candidate) => {
      const style = getComputedStyle(candidate);
      return candidate.tabIndex >= 0 && style.display !== 'none' && style.visibility !== 'hidden' && candidate.getClientRects().length > 0 && !candidate.closest('[inert],[aria-hidden="true"]') && (!candidate.closest('details:not([open])') || candidate.tagName === 'SUMMARY');
    });
    const key = element.id ? `id:${element.id}` : `tab:${tabbables.indexOf(element)}`;
    return { key, tag: element.tagName.toLowerCase(), name: name.replace(/\s+/g, ' ').trim(), inOpenDialog: Boolean(element.closest('dialog[open]')) };
  });
}
async function visibleTabbableCount(page: Page): Promise<number> {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')).filter((element) => {
    const style = getComputedStyle(element);
    return element.tabIndex >= 0 && style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0 && !element.closest('[inert],[aria-hidden="true"]') && (!element.closest('details:not([open])') || element.tagName === 'SUMMARY');
  }).length);
}
async function tabThroughPage(page: Page, maxStops = 120) {
  const first = await page.evaluate(() => {
    const selector = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
    const element = Array.from(document.querySelectorAll<HTMLElement>(selector)).find((candidate) => {
      const style = getComputedStyle(candidate);
      return candidate.tabIndex >= 0 && style.display !== 'none' && style.visibility !== 'hidden' && candidate.getClientRects().length > 0 && !candidate.closest('[inert],[aria-hidden="true"]') && (!candidate.closest('details:not([open])') || candidate.tagName === 'SUMMARY');
    });
    element?.focus();
    return Boolean(element);
  });
  const stops: NonNullable<FocusInfo>[] = [];
  const visited = new Set<string>();
  let cycleCompleted = false;
  if (first) {
    const initial = await activeFocus(page);
    if (initial) { stops.push(initial); visited.add(initial.key); }
  }
  for (let index = 0; index < maxStops; index++) {
    await page.keyboard.press('Tab');
    const focus = await activeFocus(page);
    if (!focus) break;
    if (visited.has(focus.key)) { cycleCompleted = true; break; }
    visited.add(focus.key);
    stops.push(focus);
  }
  return { stops, cycleCompleted };
}

const screenshotDirectory = path.resolve('docs/evidence/private/keyboard-application');
await mkdir(screenshotDirectory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: Array<Record<string, unknown>> = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const nonLoopbackRequests: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(requestUrl.hostname)) nonLoopbackRequests.push(requestUrl.origin);
    });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    const firstVisitAxe = await new AxeBuilder({ page }).analyze();

    const firstVisitStops: FocusInfo[] = [];
    let pasteDialogOpenedByKeyboard = false;
    for (let index = 0; index < 120; index++) {
      await page.keyboard.press('Tab');
      const focus = await activeFocus(page);
      if (!focus) break;
      firstVisitStops.push(focus);
      if (focus.name === 'Paste label text') {
        await page.keyboard.press('Enter');
        pasteDialogOpenedByKeyboard = true;
        break;
      }
    }

    const dialog = page.locator('dialog[open]');
    await dialog.waitFor({ state: 'visible', timeout: 3000 });
    const dialogStops: FocusInfo[] = [];
    let textReadActivatedByKeyboard = false;
    let labelEnteredByKeyboardFlow = false;
    for (let index = 0; index < 50; index++) {
      await page.keyboard.press('Tab');
      const focus = await activeFocus(page);
      if (!focus) throw new Error('Focus left the open label-text dialog.');
      if (!focus.inOpenDialog) throw new Error('Focus escaped the open label-text dialog.');
      dialogStops.push(focus);
      if (focus.name === 'Label text') {
        await page.keyboard.type('Ingredients: oats, water.');
        labelEnteredByKeyboardFlow = true;
      }
      if (focus.name === 'Read label text') {
        await page.keyboard.press('Enter');
        textReadActivatedByKeyboard = true;
        break;
      }
    }
    await page.locator('.results-section').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    const focusAfterDialogClose = await activeFocus(page);
    const resultAxe = await new AxeBuilder({ page }).analyze();

    const resultExpectedTabbables = await visibleTabbableCount(page);
    const resultTraversal = await tabThroughPage(page);
    const resultStops = resultTraversal.stops;
    const allStops = [...firstVisitStops, ...dialogStops, ...resultStops];
    const unnamedStops = allStops.filter((focus): focus is NonNullable<FocusInfo> => Boolean(focus && !focus.name)).map((focus) => ({ tag: focus.tag, key: focus.key }));
    const prefix = viewport.width === 390 ? 'mobile' : 'desktop';
    await page.screenshot({ path: path.join(screenshotDirectory, `${prefix}.png`), fullPage: true });

    const freshFirstPage = await context.newPage();
    freshFirstPage.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(requestUrl.hostname)) nonLoopbackRequests.push(requestUrl.origin);
    });
    await freshFirstPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await freshFirstPage.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    const firstVisitExpectedTabbables = await visibleTabbableCount(freshFirstPage);
    const firstVisitTraversal = await tabThroughPage(freshFirstPage);
    const outcome = {
      viewport: `${viewport.width}x${viewport.height}`,
      firstVisitFocusStops: firstVisitTraversal.stops.length,
      firstVisitExpectedTabbables,
      firstVisitTabbablesCovered: firstVisitTraversal.stops.length === firstVisitExpectedTabbables,
      firstVisitUnnamedStops: firstVisitTraversal.stops.filter((focus) => !focus.name).length,
      pasteDialogOpenedByKeyboard,
      dialogFocusStops: dialogStops.length,
      focusStayedInsideDialog: dialogStops.length > 0 && dialogStops.every((focus) => focus.inOpenDialog),
      labelEnteredByKeyboardFlow,
      textReadActivatedByKeyboard,
      focusReturnedToPasteTrigger: focusAfterDialogClose?.name === 'Paste label text',
      resultFocusStops: resultStops.length,
      resultExpectedTabbables,
        observedResultFocus: resultStops.map(({ tag, name }) => ({ tag, name })),
      resultTabbablesCovered: resultStops.length === resultExpectedTabbables,
      resultUnnamedStops: resultStops.filter((focus) => !focus.name).length,
      axeViolations: [...firstVisitAxe.violations, ...resultAxe.violations].map((violation) => violation.id).filter((id, index, ids) => ids.indexOf(id) === index).sort(),
      noNonLoopbackRequests: nonLoopbackRequests.length === 0,
      pageErrors,
      screenshot: `docs/evidence/private/keyboard-application/${prefix}.png`,
    };
    outcomes.push(outcome);
    await context.close();
  }
} finally {
  await browser.close();
}

const receipt = {
  schemaVersion: 1,
  kind: 'application-keyboard-browser-acceptance',
  generatedAt: new Date().toISOString(),
  browser: 'Chrome via Playwright, headless',
  origin: 'loopback',
  fixture: 'Synthetic text-only ingredients; no nutrient values or product identity.',
  limitations: ['Tests keyboard traversal on the first-visit page and text-only result view plus text-intake dialog.', 'Does not establish full screen-reader support, switch/speech input, touch-device behavior or complete WCAG conformance.'],
  outcomes,
};
await writeFile('docs/evidence/keyboard-application-browser.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ receipt: 'docs/evidence/keyboard-application-browser.json', outcomes }, null, 2));
if (outcomes.length !== 2 || outcomes.some((outcome) => !outcome.firstVisitFocusStops || !outcome.firstVisitTabbablesCovered || outcome.firstVisitUnnamedStops || !outcome.pasteDialogOpenedByKeyboard || !outcome.focusStayedInsideDialog || !outcome.labelEnteredByKeyboardFlow || !outcome.textReadActivatedByKeyboard || !outcome.focusReturnedToPasteTrigger || !outcome.resultFocusStops || !outcome.resultTabbablesCovered || outcome.resultUnnamedStops || outcome.axeViolations.length || !outcome.noNonLoopbackRequests || outcome.pageErrors.length)) process.exitCode = 1;
