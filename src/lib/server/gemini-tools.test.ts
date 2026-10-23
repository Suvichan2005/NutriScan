import { afterEach, describe, expect, it, vi } from 'vitest';
import { evidenceSources } from '../../modules/knowledge';
import type { PackageData, TentativeStructuredCandidate } from '../contracts';
import { executeGeminiTool, type GeminiToolContext } from './gemini-tools';

const mocks = vi.hoisted(() => ({ semanticRetrieve: vi.fn(), searchOpenFoodTox: vi.fn() }));
vi.mock('../semantic', () => ({ semanticRetrieve: mocks.semanticRetrieve, searchOpenFoodTox: mocks.searchOpenFoodTox }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function context(question: string, line = 'INGREDIENTS: REFINED WHEAT FLOUR; 019'): GeminiToolContext {
  const packageData: PackageData = {
    id: 'package-test', name: 'Unidentified package', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [],
    observations: [{ id: 'ocr-1', field: 'ocr-line', text: line, side: 'back', confidence: 60, origin: 'ocr', imageId: 'image-1', readingOrder: { runId: 'run-1', blockIndex: 0, paragraphIndex: 0, lineIndex: 0 } }],
    rawText: line, warnings: [], synthetic: true, createdAt: new Date().toISOString(),
  };
  return { question, package: packageData, visualImages: [], searchTerms: new Set(), prepareImage: async image => image.base64 };
}

describe('Gemini tool retrieval boundaries', () => {
  it('calculates from a prior photo-linked candidate only while its source image is attached', async () => {
    const imageContext = context('How much protein is in 20 g?');
    const candidate: TentativeStructuredCandidate = {
      candidateId: 'visual-protein', kind: 'nutrient', field: 'protein', proposedValue: '8.8 g per 100 g', numericValue: 8.8, unit: 'g',
      basis: { amount: 100, unit: 'g', description: 'per 100 g' }, normalizedEntity: 'protein', status: 'tentative', observationIds: [], sourceIds: [], supportingSpans: [],
      visualEvidence: [
        { imageId: 'package-photo', visibleText: 'PROTEIN 8.8 g', region: { x: 0.1, y: 0.2, width: 0.4, height: 0.1 } },
        { imageId: 'package-photo', visibleText: 'QUANTITY PER 100 g', region: { x: 0.4, y: 0.1, width: 0.3, height: 0.1 } },
      ], uncertainty: 'Tentative photo interpretation; not independently verified.',
    };
    imageContext.interpretedCandidates = [candidate];
    imageContext.visualImages.push({
      imageId: 'package-photo', mimeType: 'image/jpeg', base64: 'a'.repeat(20), side: 'back', sourceImage: { width: 100, height: 100 },
      preprocessing: { rotation: 0, contrast: false, invert: false, crop: null },
    });

    const result = await executeGeminiTool('calculate_nutrition', { nutrient: 'protein', amount: 20, unit: 'g', candidateId: candidate.candidateId }, imageContext);
    const calculation = result.calculations?.[0];

    expect(result.status).toBe('ok');
    expect(calculation).toMatchObject({ result: 1.76, imageIds: ['package-photo'], interpretationIds: ['visual-protein'] });
    expect(result.output.note).toMatch(/does not confirm or overwrite/i);
    imageContext.visualImages = [];
    expect((await executeGeminiTool('calculate_nutrition', { nutrient: 'protein', amount: 20, unit: 'g', candidateId: candidate.candidateId }, imageContext)).status).toBe('withheld');
  });

  it('does not send a numeric OCR fragment to the product catalog', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await executeGeminiTool('lookup_product', { query: '019' }, context('What does INS 319 mean?'));
    expect(result.status).toBe('withheld');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires a valid exact GTIN before an exact product lookup', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await executeGeminiTool('lookup_product', { barcode: '8901928202754' }, context('Check barcode 8901928202754'));
    expect(result.status).toBe('withheld');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('normalizes a grouped visual barcode and returns only the exact catalog code', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 1, product: {
      code: '8901928202755', product_name: 'Bisk Farm Sugar Free Cream Cracker', brands: 'Bisk Farm', quantity: '200 g', countries_tags: ['en:india'],
      nutrition_data_per: '100g', nutriments: { sugars_100g: 0 },
    } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const imageContext = context('Check the printed barcode and product record.');
    imageContext.visualImages.push({
      imageId: 'package-photo', mimeType: 'image/jpeg', base64: 'a'.repeat(20), side: 'back', sourceImage: { width: 100, height: 100 },
      preprocessing: { rotation: 0, contrast: false, invert: false, crop: null },
    });
    const result = await executeGeminiTool('lookup_product', { query: '8 901928 202755' }, imageContext);
    expect(result.status).toBe('ok');
    expect(result.output.candidates).toMatchObject([{ barcode: '8901928202755', match: 'barcode' }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('filters semantically nearby records that share no specific query term', async () => {
    const relevant = evidenceSources.find(source => source.id === 'who-sugars-2015')!;
    const irrelevant = evidenceSources.find(source => source.id === 'fssai-industrial-trans-fat-2021')!;
    mocks.semanticRetrieve.mockResolvedValue({
      status: 'ok', mode: 'hybrid-local-embedding', corpusVersion: 'test',
      results: [
        { source: irrelevant, score: 0.49, exactIdentity: false },
        { source: relevant, score: 0.44, exactIdentity: false },
      ], limitations: [],
    });
    const result = await executeGeminiTool('search_knowledge', { query: 'added sugar' }, context('Does this contain added sugar?'));
    expect(result.status).toBe('ok');
    expect(result.evidence?.map(source => source.id)).toEqual(['who-sugars-2015']);
  });

  it('permits a second research step using a name returned by exact local additive resolution', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ resultList: { result: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const toolContext = context('What does EFSA say about exposure from INS 319?', 'ANTIOXIDANT (319)');

    const blocked = await executeGeminiTool('search_research', { query: 'TBHQ EFSA exposure', topic: 'science' }, toolContext);
    expect(blocked.status).toBe('withheld');
    expect(fetcher).not.toHaveBeenCalled();

    const identity = await executeGeminiTool('resolve_ingredient', { query: '319' }, toolContext);
    expect(identity.status).toBe('ok');
    for (const term of identity.searchTerms ?? []) toolContext.searchTerms.add(term);

    const followup = await executeGeminiTool('search_research', { query: 'TBHQ EFSA exposure', topic: 'science' }, toolContext);
    expect(followup.status).toBe('empty');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetcher.mock.calls[0][0])).hostname).toBe('www.ebi.ac.uk');
  });

  it('resolves INS 319 to the WHO JECFA assessment without implying dose or exposure', async () => {
    const result = await executeGeminiTool('resolve_ingredient', { query: 'INS 319' }, context('What does INS 319 mean?'));
    expect(result.status).toBe('ok');
    expect(result.output).toMatchObject({ status: 'identity_match', identity: { name: 'Tertiary butylhydroquinone', code: '319' } });
    expect(result.evidence?.map(source => source.id)).toEqual(['who-jecfa-tbhq-319', 'codex-gsfa-tbhq-319']);
    expect(result.evidence?.[0].summary).toContain('0–0.7 mg/kg body weight');
    expect(result.evidence?.[0].limitations).toContain('ingredient declaration alone cannot establish dose');
  });

  it('offers exact EFSA assessment records to Gemini with source and exposure limits', async () => {
    const source = {
      version: '3.0' as const, sourceSha256: 'a'.repeat(64), sourceUrl: 'https://doi.org/10.5281/zenodo.19388272',
      releaseDate: '2026-04-30', license: 'CC BY-ND 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nd/4.0/',
      attribution: 'European Food Safety Authority (EFSA), OpenFoodTox 3.0.',
    };
    mocks.searchOpenFoodTox.mockResolvedValue({
      status: 'ok', source, statistics: { substances: 7880, assessmentRowsWithAdi: 1228 },
      results: [{
        score: 95, matchedBy: 'exact-name',
        substance: {
          substanceId: 'sub-tbhq', name: 'Tertiary-butyl hydroquinone (TBHQ)', referenceSubstanceId: 'ref-tbhq',
          aliases: ['TBHQ'], identifiers: { casNumber: '1948-33-0', pubchemCid: 16043 }, type: ['mono-constituent substance'],
          references: [{ dossierId: 'dossier-1', title: 'EFSA opinion on TBHQ', date: '2025-01-01', persistentId: 'doi:10.2903/j.efsa.2025.1', foodDomain: 'food additives' }],
          assessments: [{ assessmentId: 'assessment-1', adi: { 'Adi.lowerValue': 0.7, 'Adi.Unit': 'mg/kg bw/day', Population: 'consumers', OverallUncertainty: 100 }, acuteReferenceDose: null }],
        },
      }],
    });
    const result = await executeGeminiTool('get_substance_assessments', { query: 'INS 319' }, context('What does INS 319 mean?'));
    expect(result.status).toBe('ok');
    expect(mocks.searchOpenFoodTox).toHaveBeenCalledWith(expect.stringMatching(/hydroquinone/i), 3);
    expect(result.evidence?.[0]).toMatchObject({ id: 'openfoodtox-v3-sub-tbhq', publisher: expect.stringContaining('EFSA'), category: 'assessment' });
    expect(result.evidence?.[0].summary).toContain('ADI: 0.7 mg/kg bw/day');
    expect(result.evidence?.[0].limitations).toContain('not proof of package presence');
    expect(JSON.stringify(result.output)).not.toContain('profile');
  });

  it('does not substitute the small curated index when the local EFSA import is missing', async () => {
    mocks.searchOpenFoodTox.mockResolvedValue({ status: 'unavailable', reason: 'not-imported', results: [] });
    const result = await executeGeminiTool('get_substance_assessments', { query: 'Tertiary butylhydroquinone' }, context('What is TBHQ?'));
    expect(result.status).toBe('unavailable');
    expect(result.output).toMatchObject({ status: 'unavailable', reason: 'not-imported' });
    expect(result.evidence).toBeUndefined();
  });

  it('returns PubChem chemical identity candidates only for names in current text evidence', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ PropertyTable: { Properties: [{ CID: 16043, Title: 'tert-Butylhydroquinone', MolecularFormula: 'C10H14O2', IUPACName: '2-tert-butylbenzene-1,4-diol', InChIKey: 'XHFSVYHZBICRDT-UHFFFAOYSA-N' }] } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await executeGeminiTool('lookup_chemical_identity', { query: 'TBHQ' }, context('What is TBHQ?', 'INGREDIENTS: antioxidant TBHQ'));
    expect(result.status).toBe('ok');
    expect(result.evidence?.[0]).toMatchObject({ id: 'pubchem-cid-16043', category: 'registry', publisher: expect.stringContaining('PubChem') });
    expect(JSON.stringify(result.output)).not.toContain('profile');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(String(fetcher.mock.calls[0][0]));
    expect(requestedUrl.hostname).toBe('pubchem.ncbi.nlm.nih.gov');
    expect(requestedUrl.pathname).toContain('/compound/name/TBHQ/property/');
  });

  it('does not turn an INS number alone into a scientific literature search', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await executeGeminiTool('search_research', { query: 'INS 319', topic: 'science' }, context('What is INS 319?'));
    expect(result.status).toBe('withheld');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
