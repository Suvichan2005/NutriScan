import { describe, expect, it } from 'vitest';
import { geminiEvaluationCaptureEnabled, sanitizeGeminiEvaluationValue } from './gemini-evaluation-recorder';

describe('local Gemini evaluation transcript safeguards', () => {
  it('enables metadata capture only with an explicit local development opt-in', () => {
    const enabled = { NUTRISCAN_GEMINI_EVAL_CAPTURE: '1', NODE_ENV: 'development' } as NodeJS.ProcessEnv;
    expect(geminiEvaluationCaptureEnabled(enabled)).toBe(true);
    expect(geminiEvaluationCaptureEnabled({ ...enabled, NUTRISCAN_GEMINI_EVAL_CAPTURE: '0' })).toBe(false);
    expect(geminiEvaluationCaptureEnabled({ ...enabled, NODE_ENV: 'production' })).toBe(false);
    expect(geminiEvaluationCaptureEnabled({ ...enabled, VERCEL: '1' })).toBe(false);
    expect(geminiEvaluationCaptureEnabled({ ...enabled, CI: 'true' })).toBe(false);
    expect(geminiEvaluationCaptureEnabled({ ...enabled, NODE_ENV: 'test' })).toBe(false);
    expect(geminiEvaluationCaptureEnabled({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('keeps operational metadata while omitting prompt, answer, image and hidden thought content', () => {
    const safe = sanitizeGeminiEvaluationValue({
      event: 'provider_response', model: 'gemini-3.8-flash', tier: 'free', purpose: 'application', elapsedMs: 175, question: 'Read this label', apiKey: 'never-write-this',
      image: { mimeType: 'image/png', base64: Buffer.from('private fixture pixels').toString('base64') },
      response: { candidates: [{ content: { parts: [{ text: 'visible response' }, { thought: true, text: 'hidden reasoning' }, { thoughtSignature: 'opaque' }] } }] },
      usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 12, thoughtsTokenCount: 4 },
      functionCallNames: ['search_knowledge'],
      costEstimate: { estimatedTokenUsd: 0.001, estimatedTotalInr: 0.08, basis: 'private request details must not persist' },
    });
    const encoded = JSON.stringify(safe);
    expect(encoded).toContain('gemini-3.8-flash');
    expect(encoded).toContain('"tier":"free"');
    expect(encoded).toContain('"purpose":"application"');
    expect(encoded).toContain('"elapsedMs":175');
    expect(encoded).toContain('promptTokenCount');
    expect(encoded).toContain('42');
    expect(encoded).toContain('search_knowledge');
    expect(encoded).toContain('estimatedTotalInr');
    expect(encoded).toContain('0.08');
    expect(encoded).not.toContain('private request details');
    expect(encoded).not.toContain('Read this label');
    expect(encoded).not.toContain('visible response');
    expect(encoded).not.toContain('sha256');
    expect(encoded).toContain('[redacted credential]');
    expect(encoded).not.toContain('private fixture pixels');
    expect(encoded).not.toContain('never-write-this');
    expect(encoded).not.toContain('hidden reasoning');
    expect(encoded).not.toContain('opaque');
  });

  it('omits all user, package, tool and profile content regardless of synthetic-profile environment flags', () => {
    const value = {
      profile: { dietaryGoal: 'fictional profile value' }, question: 'private question', answer: 'private answer', query: 'private lookup',
      arguments: { condition: 'private condition' }, model: 'gemini-3.8-flash', package: { brand: 'private brand', rawText: 'private OCR' },
      toolNames: ['search_knowledge'], resultCount: 1,
    };
    const safe = JSON.stringify(sanitizeGeminiEvaluationValue(value));
    for (const secret of ['fictional profile value', 'private question', 'private answer', 'private lookup', 'private condition', 'private brand', 'private OCR']) {
      expect(safe).not.toContain(secret);
    }
    expect(safe).toContain('search_knowledge');
    expect(safe).toContain('resultCount');
  });
});
