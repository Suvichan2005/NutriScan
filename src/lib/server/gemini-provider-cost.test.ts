import { describe, expect, it } from 'vitest';
import { estimateGeminiTokenCostUsd, buildCountTokensRequest } from './gemini-provider';

describe('Gemini token cost estimates', () => {
  it('includes the system instruction and offered tools in paid prompt preflight', async () => {
    const contents = [{ role: 'user' as const, parts: [{ text: 'Question and package context' }] }];
    const systemInstruction = 'Interpret the package evidence and answer the user.';
    const tools = [{ googleSearch: {} }];
    const request = await buildCountTokensRequest({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction,
        tools,
        maxOutputTokens: 1200,
        responseMimeType: 'application/json',
      },
    });
    const countedContents = request.contents as Array<{ role?: string; parts?: Array<{ text?: string }> }>;

    expect(request.model).toBe('gemini-3.8-flash');
    expect(countedContents[0]).toEqual(contents[0]);
    expect(countedContents[1]?.parts?.[0]?.text).toContain(systemInstruction);
    expect(countedContents[1]?.parts?.[0]?.text).toContain('googleSearch');
    expect(request).not.toHaveProperty('config');
  });

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
