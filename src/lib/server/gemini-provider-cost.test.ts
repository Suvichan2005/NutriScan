import { describe, expect, it } from 'vitest';
import { estimateGeminiTokenCostUsd } from './gemini-provider';

describe('Gemini token cost estimates', () => {
  it('prices reported cached input, tool-use input and thinking tokens separately', () => {
    const estimate = estimateGeminiTokenCostUsd({
      promptTokenCount: 1_000_000,
      cachedContentTokenCount: 500_000,
      candidatesTokenCount: 10,
      thoughtsTokenCount: 20,
      toolUsePromptTokenCount: 5,
    }, { input: 0.75, cachedInput: 0.075, output: 3.75 });
    expect(estimate).toBeCloseTo(0.41261625, 8);
  });

  it('does not estimate a completed usage price when required token counts are missing', () => {
    expect(estimateGeminiTokenCostUsd(undefined, { input: 0.75, cachedInput: 0.075, output: 3.75 })).toBeNull();
    expect(estimateGeminiTokenCostUsd({ promptTokenCount: 10 }, { input: 0.75, cachedInput: 0.075, output: 3.75 })).toBeNull();
  });
});
