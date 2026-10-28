import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../contracts';
import { profileForGemini } from '../profile-startup';
import { assistInput, assistPromptPayload } from '../server/gemini';
import { parseLabel } from '../parser';

describe('context reaches the production model payload only with consent', () => {
  const profile = { ...defaultProfile, dietaryPattern: 'Fictional vegetarian', avoidedIngredients: 'Coconut', allergies: 'Fictional declared allergen', intolerances: 'Fictional intolerance', portionPreferences: 'Compare half a package', goals: 'Compare protein and sodium', healthConsiderations: 'Fictional professional guidance', ageGroup: 'Adult', sexOrReferenceGroup: 'User supplied', country: 'India', locality: 'Fictional place' };
  function payload(share: boolean) {
    const shared = profileForGemini(profile, share);
    return assistPromptPayload(assistInput.parse({ consent: true, question: 'Use the relevant context.', package: parseLabel('Illustrative label\nProtein 8 g per 100 g', { origin: 'user' }), ...(shared ? { profile: shared } : {}) }));
  }
  it('preserves every optional field through the real assist contract and prompt adapter', () => {
    expect(payload(true).profile).toEqual(profile);
  });
  it('omits all profile fields and their contents for local-only context', () => {
    const result = payload(false);
    expect(result).not.toHaveProperty('profile');
    for (const value of Object.values(profile)) expect(JSON.stringify(result)).not.toContain(value);
    expect(profileForGemini(defaultProfile, true)).toBeUndefined();
  });
});
