import { describe, expect, it } from 'vitest';
import { geminiEvaluationCaptureEnabled, sanitizeGeminiEvaluationValue } from './gemini-evaluation-recorder';

describe('local Gemini evaluation transcript safeguards', () => {
  it('enables readable capture only with an explicit local development opt-in', () => {
    const enabled = { NUTRISCAN_GEMINI_EVAL_CAPTURE: '1', NODE_ENV: 'development' } as NodeJS.ProcessEnv;
    expect(geminiEvaluationCaptureEnabled(enabled)).toBe(true);
    expect(geminiEvaluationCaptureEnabled({ ...enabled, NUTRISCAN_GEMINI_EVAL_CAPTURE: '0' })).toBe(false);
    expect(geminiEvaluationCaptureEnabled({ ...enabled, NODE_ENV: 'production' })).toBe(false);
    expect(geminiEvaluationCaptureEnabled({ ...enabled, VERCEL: '1' })).toBe(false);
    expect(geminiEvaluationCaptureEnabled({ ...enabled, CI: 'true' })).toBe(false);
    expect(geminiEvaluationCaptureEnabled({ ...enabled, NODE_ENV: 'test' })).toBe(false);
    expect(geminiEvaluationCaptureEnabled({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('keeps authorized prompt text but replaces images with hashes and removes credentials and hidden thought', () => {
    const safe = sanitizeGeminiEvaluationValue({
      question: 'Read this label', apiKey: 'never-write-this',
      image: { mimeType: 'image/png', base64: Buffer.from('private fixture pixels').toString('base64') },
      parts: [{ text: 'visible response' }, { thought: true, text: 'hidden reasoning' }, { thoughtSignature: 'opaque' }],
    });
    const encoded = JSON.stringify(safe);
    expect(encoded).toContain('Read this label');
    expect(encoded).toContain('sha256');
    expect(encoded).toContain('bytesOmitted');
    expect(encoded).toContain('[redacted credential]');
    expect(encoded).not.toContain('private fixture pixels');
    expect(encoded).not.toContain('never-write-this');
    expect(encoded).not.toContain('hidden reasoning');
    expect(encoded).not.toContain('opaque');
  });

  it('omits real profile-dependent content by default and permits it only with the explicit synthetic-profile flag', () => {
    const value = { profile: { dietaryGoal: 'diabetes management' }, question: 'Will this snack work?', answer: 'Maybe.', query: 'diabetes snack advice', arguments: { condition: 'diabetes' }, model: 'gemini-3.8-flash' };
    const safeDefault = JSON.stringify(sanitizeGeminiEvaluationValue(value, '', null, { profileIncluded: true }));
    expect(safeDefault).not.toContain('diabetes management');
    expect(safeDefault).not.toContain('Will this snack work?');
    expect(safeDefault).not.toContain('diabetes snack advice');
    expect(safeDefault).not.toContain('"condition":"diabetes"');
    const safeSynthetic = JSON.stringify(sanitizeGeminiEvaluationValue(value, '', null, { profileIncluded: true, allowProfileContent: true }));
    expect(safeSynthetic).toContain('diabetes management');
    expect(safeSynthetic).toContain('Will this snack work?');
  });
});
