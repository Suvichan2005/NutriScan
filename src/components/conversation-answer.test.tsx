import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConversationAnswer, ConversationToolActivity } from './conversation-answer';

describe('conversation clarity without semantic rewriting', () => {
  it('keeps the recommendation visible and every original caveat in an expandable explanation', () => {
    const lead = 'This could work occasionally, depending on your preferences.';
    const detail = 'The label reading remains uncertain. '.repeat(30);
    const html = renderToStaticMarkup(createElement(ConversationAnswer, { answer: `${lead}\nHere is why:\n${detail}\nCheck the original package before relying on this reading.` }));
    expect(html).toContain(`<p>${lead}</p>`);
    expect(html).toContain('<summary>Read full explanation</summary>');
    expect(html).toContain(detail.trim());
    expect(html).toContain('Check the original package before relying on this reading.');
    expect(html).not.toContain(' open=');
  });
  it('renders text rather than third-party markup and keeps short answers fully visible', () => {
    const html = renderToStaticMarkup(createElement(ConversationAnswer, { answer: '<script>alert(1)</script>\nA short answer.' }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('Read full explanation');
    expect(html).toContain('A short answer.');
  });
  it('moves only the known application notice, retaining uncertainty without impersonating Gemini', () => {
    const answer = 'A retained supported answer.\n\nI omitted one or more numerical statements that the available evidence could not verify. Some numbers are provisional package readings; confirm them in Package details.';
    const html = renderToStaticMarkup(createElement(ConversationAnswer, { answer }));
    expect(html).toContain('A retained supported answer.');
    expect(html).toContain('Label estimates · some details excluded');
    expect(html).not.toContain('I omitted one or more');
    expect(html).toContain('Some numerical statements could not be verified');
  });
  it('keeps short structured answers visible instead of adding an explanation gate for a heading', () => {
    const html = renderToStaticMarkup(createElement(ConversationAnswer, { answer: 'For half the printed serving:\n- Protein: 1.67 g\n- Carbohydrate: 13.15 g\n## Label context\nThese remain package readings.' }));
    expect(html).not.toContain('Read full explanation');
    expect(html).toContain('Protein: 1.67 g');
    expect(html).toContain('These remain package readings.');
  });
  it('shows only actual recorded activity and distinguishes a failed tool from completion', () => {
    expect(renderToStaticMarkup(createElement(ConversationToolActivity, { trace: [] }))).toBe('');
    const html = renderToStaticMarkup(createElement(ConversationToolActivity, { trace: [
      { name: 'calculate_nutrition', status: 'ok', resultCount: 1, elapsedMs: 20 },
      { name: 'get_nutrition_guidance', status: 'error', resultCount: 0, elapsedMs: 1200 },
    ] }));
    expect(html).toContain('calculate_nutrition');
    expect(html).toContain('Completed · 1 result');
    expect(html).toContain('error · 0 results');
    expect(html).not.toContain('Completed · 0 results');
  });
});
