import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

// Local UI contract replay. The provider response was recorded in an earlier
// synthetic development run; this test makes its answer uncited while keeping
// the returned source records, so it tests presentation/storage only.
const baseUrl = process.env.NUTRISCAN_BASE_URL ?? 'http://127.0.0.1:3457';
const fixturePath = path.resolve('.data/m2-source-acceptance-20261027/synthetic-sodium-live-20261027.json');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as { turns: Array<{ question: string; response: Record<string, unknown> }> };
const initial = structuredClone(fixture.turns[0].response);
const retrieved = initial.agentEvidence as Array<{ id: string; title: string }>;
assert(retrieved.length > 0, 'Recorded synthetic fixture must contain returned source records.');
initial.answer = 'The label records sodium for the stated basis. This answer intentionally does not cite the returned research sources.';
const captureDir = path.resolve('.data/m2-retrieved-evidence-acceptance-20261027');
await mkdir(captureDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report: Record<string, unknown>[] = [];

try {
  for (const viewport of [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors: string[] = [];
    const external: string[] = [];
    const requests: Record<string, unknown>[] = [];
    let assistCount = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(request.url()).hostname)) external.push(new URL(request.url()).origin);
    });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return route.abort();
      if (url.pathname === '/api/status') return route.fulfill({ json: {
        status: 'ok',
        gemini: { enabled: true, configured: true, model: 'gemini-3.6-flash', tier: 'free', paidFallbackEnabled: false, searchEnabled: false },
        developerDiagnostics: { readableEvaluationCapture: false },
      } });
      if (url.pathname === '/api/assist') {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        requests.push(body);
        assistCount++;
        const response = structuredClone(initial);
        const packageData = body.package as { observations?: Array<{ id?: string; text?: string; rawText?: string }> };
        const observation = packageData.observations?.find(item => /650\s*mg/i.test(item.text ?? item.rawText ?? ''));
        assert(observation?.id, 'Synthetic package request did not preserve the sodium observation link.');
        const remap = (value: unknown): unknown => {
          if (Array.isArray(value)) return value.map(remap);
          if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)]));
          return value === 'label-sodium' ? observation.id : value;
        };
        Object.assign(response, remap(response));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
      }
      return route.continue();
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => {
      const dialog = document.querySelector('dialog.onboarding-dialog');
      const question = document.querySelector<HTMLTextAreaElement>('#initial-question');
      return !!dialog?.open || (!!question && !question.disabled);
    });
    const onboarding = page.getByRole('dialog', { name: 'Make NutriScan yours' });
    if (await onboarding.isVisible()) {
      await onboarding.getByRole('radio', { name: 'Understand a food claim' }).check();
      await onboarding.getByRole('button', { name: 'Continue' }).click();
      await onboarding.waitFor({ state: 'hidden' });
    }
    await page.waitForFunction(() => {
      const dialog = document.querySelector('dialog.onboarding-dialog');
      const question = document.querySelector<HTMLTextAreaElement>('#initial-question');
      return !dialog?.open && !!question && !question.disabled;
    });
    await page.locator('#initial-question').fill(fixture.turns[0].question);
    await page.locator('.empty-thread-advanced > summary').click();
    await page.getByLabel('Product name or detail').fill('Synthetic development label. Serving size 35 g. Nutrition information per 100 g. Sodium 650 mg. Ingredients: wheat flour, vegetable oil, salt.');
    await page.locator('.empty-thread-advanced > summary').click();
    await page.getByRole('button', { name: 'Analyze details' }).click();
    const firstTurn = page.locator('.thread-turn').first();
    await firstTurn.getByText(/does not cite the returned research sources/i).waitFor({ state: 'visible' });
    assert.equal(await firstTurn.locator('details.conversation-evidence').count(), 0, 'Retrieved sources must not become answer citations.');

    await page.getByRole('button', { name: /Open package inspector/ }).click();
    await page.getByRole('button', { name: 'Sources & OCR' }).click();
    const evidencePanel = page.locator('.inspector-tab-panel[aria-label="Sources and package observations"]');
    const evidenceText = await evidencePanel.innerText();
    for (const source of retrieved) assert(evidenceText.includes(source.title), `Retrieved source absent from inspector: ${source.title}`);
    assert.match(evidenceText, /Retrieved for a turn · not cited in its answer/);
    await page.screenshot({ path: path.join(captureDir, `${viewport.name}-retrieved-not-cited.png`), fullPage: true });
    await page.getByRole('button', { name: /Close package inspector/ }).click();
    assert.equal(assistCount, 1);
    assert.equal(((requests[0].images as unknown[]) ?? []).length, 0, 'Text-only fixture should not send photos.');
    assert.equal(await page.locator('.thread-turn').count(), 1, 'Expected one assistant turn for the question.');
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await page.screenshot({ path: path.join(captureDir, `${viewport.name}-chat-after-inspector.png`), fullPage: true });
    report.push({ viewport: viewport.name, retrievedSourceCount: retrieved.length, answerCitationCount: 0, inspectorLabelsUncited: true, providerRouteCalls: assistCount, pageErrors: errors, externalRequests: external });
    await context.close();
  }
} finally {
  await browser.close();
}

await writeFile(path.join(captureDir, 'result.json'), JSON.stringify({ providerCallsInThisAcceptance: 0, sourceFixture: 'synthetic sodium development response replay', report }, null, 2));
console.log(JSON.stringify({ captureDir, report }, null, 2));
