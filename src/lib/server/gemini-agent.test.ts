import { describe, expect, it } from 'vitest';
import { evidenceSources } from '../../modules/knowledge';
import { attachGoogleGrounding, googleGroundingEvidence, normalizeModelImageRegions, toolResultForModel } from './gemini';

describe('Gemini tool citation feedback', () => {
  it('returns the exact bounded evidence summary that final citation validation checks', () => {
    const source = evidenceSources.find(item => item.id === 'who-sugars-2015')!;
    const result = toolResultForModel({ status: 'ok', resultCount: 1 }, [source]);
    const citation = (result.citationEvidence as Array<Record<string, unknown>>)[0];

    expect(citation).toMatchObject({
      sourceId: source.id,
      title: source.title,
      publisher: source.publisher,
      url: source.url,
      summary: source.summary,
      limitations: source.limitations,
    });
    expect(source.summary.includes(String(citation.summary))).toBe(true);
    expect((toolResultForModel({ status: 'empty' }).citationEvidence)).toBeUndefined();
  });

  it('bounds each tool response to five citations and validator-safe field lengths', () => {
    const sources = Array.from({ length: 6 }, (_, index) => ({
      ...evidenceSources[0],
      id: `source-${index}`,
      title: 't'.repeat(300),
      publisher: 'p'.repeat(200),
      url: `https://example.org/${index}`,
      jurisdiction: 'j'.repeat(250),
      summary: 's'.repeat(2000),
      limitations: 'l'.repeat(700),
    }));
    const result = toolResultForModel({}, sources);
    const citations = result.citationEvidence as Array<Record<string, unknown>>;

    expect(citations).toHaveLength(5);
    expect(citations[0].title).toHaveLength(240);
    expect(citations[0].publisher).toHaveLength(160);
    expect(citations[0].summary).toHaveLength(1200);
    expect(citations[0].limitations).toHaveLength(500);
  });
});

describe('Google Search grounding evidence', () => {
  const segment = 'EFSA reported high-level exposure estimates above the ADI for toddlers and children when using maximum permitted levels.';
  const metadata = {
    webSearchQueries: ['EFSA TBHQ refined exposure assessment'],
    groundingChunks: [
      { web: { uri: 'https://www.efsa.europa.eu/en/efsajournal/pub/4363', title: 'EFSA refined exposure assessment' } },
      { web: { uri: 'http://example.org/insecure', title: 'Insecure page' } },
      { web: { uri: 'https://localhost/private', title: 'Local page' } },
    ],
    groundingSupports: [
      { segment: { text: segment }, groundingChunkIndices: [0] },
      { segment: { text: segment }, groundingChunkIndices: [1, 2] },
    ],
  } as const;

  it('keeps only secure public web citations and labels generated text separately from source text', () => {
    const evidence = googleGroundingEvidence(metadata as never);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      title: 'EFSA refined exposure assessment',
      publisher: 'Google Search grounding via Gemini',
      category: 'web-search',
      url: 'https://www.efsa.europa.eu/en/efsajournal/pub/4363',
      summary: segment,
    });
    expect(evidence[0].limitations).toMatch(/not a quotation or text fetched and independently reviewed/i);
  });

  it('attaches only an exact provider-grounded segment that matches a claim', () => {
    const [source] = googleGroundingEvidence(metadata as never);
    const output = {
      answer: 'EFSA reported exposure estimates above the ADI for some children under maximum-use assumptions.',
      claims: [{
        mode: 'synthesis',
        text: segment,
        observationIds: [],
        sourceIds: [],
        supportingSpans: [],
      }],
      limitations: [],
      inspectImage: null,
    };
    const result = attachGoogleGrounding(output, [source]) as typeof output;
    expect(result.claims[0].sourceIds).toEqual([source.id]);
    expect(result.claims[0].supportingSpans).toEqual([{ kind: 'source', id: source.id, quote: source.summary }]);
  });

  it('cleans JSON-encoded response segments before exposing them as generated-grounded evidence', () => {
    const encodedSegment = '"text": "Under refined dietary exposure scenarios, EFSA concluded the ADI was not exceeded in any population group."';
    const [source] = googleGroundingEvidence({
      groundingChunks: [{ web: { uri: 'https://www.efsa.europa.eu/en/efsajournal/pub/4363', title: 'EFSA Journal 4363' } }],
      groundingSupports: [{ segment: { text: encodedSegment }, groundingChunkIndices: [0] }],
    } as never);
    expect(source.summary).toBe('Under refined dietary exposure scenarios, EFSA concluded the ADI was not exceeded in any population group.');
  });

  it('does not attach a weakly related source or a source missing numeric support', () => {
    const [source] = googleGroundingEvidence({
      ...metadata,
      groundingSupports: [{ segment: { text: 'EFSA reported an ADI value of 0.7 mg/kg body weight for TBHQ.' }, groundingChunkIndices: [0] }],
    } as never);
    const output = {
      answer: 'This product contains 12 mg of the substance.',
      claims: [{ mode: 'synthesis', text: 'This product contains 12 mg of the substance.', observationIds: [], sourceIds: [], supportingSpans: [] }],
      limitations: [], inspectImage: null,
    };
    const result = attachGoogleGrounding(output, [source]) as typeof output;
    expect(result.claims[0].sourceIds).toEqual([]);
    expect(result.claims[0].supportingSpans).toEqual([]);
  });
});

describe('Gemini visual-region normalization', () => {
  it('withholds coordinates outside the normalized image while keeping the linked text tentative', () => {
    const input = {
      answer: 'An image-linked reading remains unverified.',
      claims: [{
        mode: 'synthesis', text: 'The package may say cream crackers.', observationIds: [], sourceIds: [], supportingSpans: [],
        visualEvidence: [{ imageId: 'side-1', visibleText: 'CREAM CRACKER', region: { x: 18, y: 22, width: 64, height: 35 } }],
      }],
      tentativeCandidates: [{
        candidateId: 'candidate-1', kind: 'product-identity', field: 'product', proposedValue: 'Cream cracker', numericValue: null,
        unit: null, basis: null, normalizedEntity: null, status: 'tentative', observationIds: [], sourceIds: [], supportingSpans: [],
        visualEvidence: [{ imageId: 'side-1', visibleText: 'CREAM CRACKER', region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } }], uncertainty: 'Image text is unverified.',
      }],
      limitations: [], inspectImage: null,
    };
    const result = normalizeModelImageRegions(input) as { output: typeof input; discardedRegionCount: number };
    expect(result.discardedRegionCount).toBe(1);
    expect(result.output.claims[0].visualEvidence[0]).toEqual({ imageId: 'side-1', visibleText: 'CREAM CRACKER', region: null });
    expect(result.output.tentativeCandidates[0].visualEvidence?.[0].region).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
  });

  it('does not alter unrelated model output or already-withheld image regions', () => {
    const input = {
      answer: 'No image location was established.',
      claims: [{ mode: 'synthesis', text: 'The visible text is tentative.', observationIds: [], sourceIds: [], supportingSpans: [], visualEvidence: [{ imageId: 'side-1', visibleText: 'TEXT', region: null }] }],
      limitations: ['Unverified.'], inspectImage: null,
    };
    const result = normalizeModelImageRegions(input);
    expect(result.discardedRegionCount).toBe(0);
    expect(result.output).toEqual(input);
  });
});
