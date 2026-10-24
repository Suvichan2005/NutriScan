import { describe, expect, it, vi } from 'vitest';
import { geminiDiagnosticsEnabled, sanitizeGeminiDiagnosticValue } from './gemini-diagnostics';

describe('Gemini local diagnostic redaction', () => {
  it('keeps operational metadata and hashes selected images while omitting request and response content', () => {
    const imageBytes = Buffer.from('private-package-photo').toString('base64');
    const value = sanitizeGeminiDiagnosticValue({
      request: {
        contents: [{ role: 'user', parts: [
          { text: JSON.stringify({ question: 'Is this a daily snack?', profile: { allergies: 'peanuts' }, package: { observations: [{ text: 'REFINED WHEAT FLOUR (MAIDA) (89.98%)' }] }, conversationContext: [{ question: 'prior private question', answer: 'prior private answer' }] }) },
          { inlineData: { mimeType: 'image/jpeg', data: imageBytes } },
        ] }],
      },
      response: { candidates: [{ content: { parts: [{ text: 'The label says 89.98% maida.' }, { thought: true, text: 'private internal reasoning' }] } }] },
      image: { inlineData: { mimeType: 'image/jpeg', data: imageBytes } },
      requestMetadata: { imageCount: 1, textPartCount: 1, toolNames: ['search_knowledge'] },
      responseMetadata: { candidateCount: 1, finishReasons: ['STOP'], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 3 } },
    });
    const serialized = JSON.stringify(value);
    expect(serialized).toContain('requestMetadata');
    expect(serialized).toContain('responseMetadata');
    expect(serialized).toContain('promptTokenCount');
    expect(serialized).toContain('search_knowledge');
    expect(serialized).toContain('imageBytesOmitted');
    expect(serialized).not.toContain('REFINED WHEAT FLOUR');
    expect(serialized).not.toContain('89.98%');
    expect(serialized).not.toContain('daily snack');
    expect(serialized).not.toContain('peanuts');
    expect(serialized).not.toContain('prior private question');
    expect(serialized).not.toContain('prior private answer');
    expect(serialized).not.toContain('private internal reasoning');
    expect(serialized).not.toContain(imageBytes);
  });

  it('retains safe call timestamps and structural output metrics without retaining model text', () => {
    const value = sanitizeGeminiDiagnosticValue({
      recordedAt: '2026-10-23T11:31:13.978Z',
      event: 'structured_output_parse',
      outputShape: { claimCount: 5, answerPartCount: 2, uiComponentTypes: ['ingredient-explorer'] },
      answer: 'Private model response containing package and health details.',
    });
    expect(value).toMatchObject({
      recordedAt: '2026-10-23T11:31:13.978Z',
      event: 'structured_output_parse',
      outputShape: { claimCount: 5, answerPartCount: 2, uiComponentTypes: ['ingredient-explorer'] },
      answer: '[omitted content]',
    });
    expect(JSON.stringify(value)).not.toContain('Private model response');
  });

  it('retains only known package coverage facet names in synthesis diagnostics',()=>{
    const value=sanitizeGeminiDiagnosticValue({
      event:'package_answer_synthesis',
      missingFacets:['nutrition','serving','local-guidance','private question text'],
      afterMissingFacets:['ingredients'],
    });
    expect(value).toMatchObject({missingFacets:['nutrition','serving','local-guidance','[omitted content]'],afterMissingFacets:['ingredients']});
    expect(JSON.stringify(value)).not.toContain('private question text');
  });

  it('keeps only the bounded recovery-region selector as operational metadata',()=>{
    const value=sanitizeGeminiDiagnosticValue({
      event:'nutrition_region_recovery',
      regionSelection:'attached-ocr-crop',
      prompt:'private label text must be omitted',
    });
    expect(value).toMatchObject({event:'nutrition_region_recovery',regionSelection:'attached-ocr-crop',prompt:'[omitted content]'});
    expect(JSON.stringify(value)).not.toContain('private label text');
  });

  it('requires both local-only and trace opt-ins and never enables tracing in tests or hosted builds', () => {
    vi.stubEnv('NUTRISCAN_GEMINI_TRACE', '1');
    vi.stubEnv('NUTRISCAN_LOCAL_DEV_ONLY', '0');
    expect(geminiDiagnosticsEnabled()).toBe(false);
    vi.stubEnv('NUTRISCAN_LOCAL_DEV_ONLY', '1');
    vi.stubEnv('VERCEL', '1');
    expect(geminiDiagnosticsEnabled()).toBe(false);
    vi.unstubAllEnvs();
  });

  it('omits arbitrary string fields so future diagnostics cannot accidentally retain conversation text', () => {
    const value = sanitizeGeminiDiagnosticValue({ event: 'provider_response', status: 'completed', futureField: 'private user question', responseMetadata: { candidateCount: 1 } });
    expect(value).toMatchObject({ event: 'provider_response', status: 'completed', futureField: '[omitted content]', responseMetadata: { candidateCount: 1 } });
    expect(JSON.stringify(value)).not.toContain('private user question');
  });

  it('omits questions and profile-derived provider output whenever a profile was sent', () => {
    const value = sanitizeGeminiDiagnosticValue({
      profileIncluded: true,
      response: { candidates: [{ content: { parts: [{ text: 'Your kidney condition changes this advice.' }] } }] },
      claim: { profileFieldIds: ['healthConsiderations'], text: 'The user declared kidney disease.', supportingSpans: [{ kind: 'profile', quote: 'kidney disease' }] },
      request: { contents: [{ parts: [{ text: JSON.stringify({ profile: { healthConsiderations: 'kidney disease' }, question: 'How is this food?' }) }] }] },
    });
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain('kidney condition');
    expect(serialized).not.toContain('kidney disease');
    expect(serialized).not.toContain('How is this food?');
    expect(serialized).toContain('omitted content');
  });
});
