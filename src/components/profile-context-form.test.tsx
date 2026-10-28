import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultProfile } from '@/lib/contracts';
import { ProfileContextForm } from './profile-context-form';

const base = { profile: defaultProfile, onChange() {}, ready: true, saving: false, sharedWithGemini: false, remember: false, onRemember() {}, onContinue() {} };
describe('optional context onboarding', () => {
  it('offers every context field without requiring a preset goal or health disclosure', () => {
    const html = renderToStaticMarkup(createElement(ProfileContextForm, base));
    for (const label of ['Dietary pattern or preferences', 'Ingredients or foods to avoid', 'Food allergies', 'Food intolerances', 'Portion preferences', 'What are you trying to understand?', 'Health considerations or professional guidance', 'Age group', 'Sex or reference group', 'Country', 'City or PIN']) expect(html).toContain(label);
    expect(html).toContain('Skip for now');
    expect(html).not.toContain('required=');
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain('checked=""');
  });
  it('makes local storage and AI sharing distinct explicit actions', () => {
    const html = renderToStaticMarkup(createElement(ProfileContextForm, { ...base, profile: { ...defaultProfile, dietaryPattern: 'Fictional vegetarian preference' } }));
    expect(html).toContain('Keep local');
    expect(html).toContain('Use in AI answers');
    expect(html).toContain('Google Gemini');
    expect(html).toContain('Saving this form sends nothing');
    expect(html).not.toContain('This context is included in your Gemini questions');
  });
});
