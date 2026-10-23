import { afterEach, describe, expect, it, vi } from 'vitest';
import { evidenceSources } from '../../modules/knowledge';
import { sourceSchema, type PackageData, type TentativeStructuredCandidate } from '../contracts';
import { executeGeminiTool, type GeminiToolContext } from './gemini-tools';

const mocks = vi.hoisted(() => ({ semanticRetrieve: vi.fn(), searchOpenFoodTox: vi.fn(), research: vi.fn() }));
vi.mock('../semantic', () => ({ semanticRetrieve: mocks.semanticRetrieve, searchOpenFoodTox: mocks.searchOpenFoodTox }));
vi.mock('./research', async importOriginal => {
  const actual = await importOriginal<typeof import('./research')>();
  mocks.research.mockImplementation((args: Parameters<typeof actual.research>[0]) => actual.research(args));
  return { ...actual, research: mocks.research };
});

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
  it('retrieves India-compatible CKD guidance locally without inventing a potassium allowance', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    const result = await executeGeminiTool('get_nutrition_guidance', {
      query: 'How should adults with CKD handle sodium and potassium?',
      condition: 'CKD',
      jurisdiction: 'India',
    }, context('How should adults with CKD handle sodium and potassium?'));

    expect(result.status).toBe('ok');
    expect(result.evidence?.map(source => source.id)).toEqual(['kdigo-ckd-2024-sodium']);
    expect(sourceSchema.array().safeParse(result.evidence).success).toBe(true);
    expect(result.evidence?.[0].summary).toMatch(/below 2 g\/day/i);
    expect(result.evidence?.[0].limitations).toMatch(/sodium-wasting nephropathy/i);
    expect(result.output).toMatchObject({ externalRequestMade: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not present U.S. diabetes guidance as India-specific when the local corpus lacks a condition-specific source', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    const result = await executeGeminiTool('get_nutrition_guidance', {
      query: 'What carbohydrate target applies to diabetes in India?',
      condition: 'diabetes',
      jurisdiction: 'India',
    }, context('What carbohydrate target applies to diabetes in India?'));

    expect(result.status).toBe('empty');
    expect(result.evidence).toEqual([]);
    expect(result.output).toMatchObject({ status: 'empty', externalRequestMade: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not cross-apply CKD sodium guidance to hypertension without a kidney context', async () => {
    const result = await executeGeminiTool('get_nutrition_guidance', {
      query: 'How should I manage sodium for hypertension in India?',
      condition: 'hypertension',
      jurisdiction: 'India',
    }, context('How should I manage sodium for hypertension in India?'));

    expect(result.status).toBe('empty');
    expect(result.evidence?.some(source => source.id === 'kdigo-ckd-2024-sodium')).toBe(false);
  });

  it('rejects oversized guidance lookups without executing retrieval', async () => {
    const result = await executeGeminiTool('get_nutrition_guidance', {
      query: 'CKD sodium',
      maxResults: 6,
    }, context('What should I eat?'));

    expect(result.status).toBe('error');
    expect(result.output).toMatchObject({ status: 'invalid_arguments' });
  });

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

  it('expands an India regulation lookup with one exactly resolved additive identity', async () => {
    mocks.research.mockResolvedValueOnce({
      status: 'ok',
      items: [{
        id: 'fssai-additive-compendium-appendix-a', title: 'FSSAI Food Products Standards and Food Additives Compendium, Appendix A',
        url: 'https://www.fssai.gov.in/docs/food-law/regulations/compendium/food-products-standards/Appendix%20A(4).pdf',
        publisher: 'Food Safety and Standards Authority of India', publishedAt: null, retrievedAt: '2026-10-23T00:00:00.000Z',
        category: 'food standards and additives compendium; navigation aid only',
        summary: 'Official PDF excerpt; Tertiary butylhydroquinone INS 319 100 mg/kg.',
        limitations: 'Navigation aid only; category and applicable notification remain unverified.',
      }],
      message: 'Source discovery only.',
    });
    const toolContext = context('Does this additive have an applicable authorization in India?', 'INGREDIENTS: antioxidant (319)');
    const identity = await executeGeminiTool('resolve_ingredient', { query: '319' }, toolContext);
    expect(identity.status).toBe('ok');
    for (const term of identity.searchTerms ?? []) toolContext.searchTerms.add(term);

    const result = await executeGeminiTool('search_research', { query: 'authorization India', topic: 'regulation' }, toolContext);

    expect(result.status).toBe('ok');
    expect(mocks.research).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'regulation', query: 'INS 319 food additive India',
    }));
    expect(result.evidence?.[0]).toMatchObject({ id: 'fssai-additive-compendium-appendix-a', category: 'regulation' });
    expect(result.evidence?.[0].limitations).toMatch(/category and applicable notification remain unverified/i);
  });

  it('expands same-round India regulation calls from an explicit INS mention without relying on tool order', async () => {
    mocks.research.mockResolvedValueOnce({ status: 'empty', items: [], message: 'No matching text was returned.' });
    const toolContext = context('Please check the FSSAI rules for INS 319 in India.', 'INGREDIENTS: antioxidant (319)');
    toolContext.searchTerms.add('INS 955');

    const result = await executeGeminiTool('search_research', { query: 'INS 319', topic: 'regulation' }, toolContext);

    expect(result.status).toBe('empty');
    expect(mocks.research).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'regulation', query: 'INS 319 food additive India',
    }));
  });

  it('keeps an exact Indian additive identity when the model labels the research topic as a claim', async () => {
    mocks.research.mockResolvedValueOnce({ status: 'empty', items: [], message: 'No matching text was returned.' });
    const toolContext = context('Does INS 319 have applicable authorization in India?');

    await executeGeminiTool('search_research', { query: 'INS 319 authorization India', topic: 'claims' }, toolContext);

    expect(mocks.research).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'claims', query: 'INS 319 food additive India',
    }));
  });

  const liveResearchIt = process.env.NUTRISCAN_LIVE_RESEARCH_TEST === 'true' ? it : it.skip;
  it('canonicalizes a context-linked additive code when identity and research tools run in parallel', async () => {
    const toolContext = context(
      'What does the label code 319 refer to, and can the FSSAI entry mentioning 100 mg/kg apply to this cream cracker?',
      'INGREDIENTS: refined wheat flour; antioxidant (319)',
    );
    mocks.research.mockResolvedValueOnce({ status: 'ok', items: [], message: 'fixture response' });

    await Promise.all([
      executeGeminiTool('resolve_ingredient', { query: '319' }, toolContext),
      executeGeminiTool('search_research', { query: 'FSSAI 100 mg/kg cream cracker', topic: 'claims' }, toolContext),
    ]);

    expect(mocks.research).toHaveBeenCalledWith(expect.objectContaining({ query: 'INS 319 food additive India', topic: 'claims' }));
  });

  liveResearchIt('retrieves the official INS excerpt through the Gemini research-tool boundary', async () => {
    const toolContext = context(
      'What does the label code 319 refer to, and can the FSSAI entry mentioning 100 mg/kg apply to this cream cracker?',
      'INGREDIENTS: refined wheat flour; antioxidant (319)',
    );
    const [, result] = await Promise.all([
      executeGeminiTool('resolve_ingredient', { query: '319' }, toolContext),
      executeGeminiTool('search_research', { query: 'FSSAI 100 mg/kg cream cracker', topic: 'claims' }, toolContext),
    ]);
    const excerpt = result.evidence?.find(item => item.id === 'fssai-additive-compendium-appendix-a');

    expect(mocks.research).toHaveBeenCalledWith(expect.objectContaining({ query: 'INS 319 food additive India', topic: 'claims' }));
    expect(result.status).toBe('ok');
    expect(excerpt?.summary).toMatch(/Tertiary butylhydroquinon.{0,80}319.{0,40}100 mg\/kg/i);
    expect(excerpt?.limitations).toMatch(/exact food category and conditions of use/i);
  }, 30_000);

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
