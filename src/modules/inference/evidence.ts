import {
  sourceSchema,
  type EvidenceSource,
  type PackageData,
  type ResearchItem,
} from '../../lib/contracts';

type LocalSearchEvidence = EvidenceSource & { score: number };
export type AssistEvidenceInputs = {
  auditSources: EvidenceSource[];
  localSearch: LocalSearchEvidence[];
  research: ResearchItem[];
  conversationEvidence?: EvidenceSource[];
};

const maxAssistSources = 15;
const maxSummaryCharacters = 1600;
const additionalPhotoMarker = /^--- Additional photo evidence ---$/;

/**
 * Avoid sending OCR-only label text twice. The raw OCR observations are the
 * richer record (line order, image/run link, boxes and recognition metadata),
 * so clear the duplicate text only when every non-empty line is represented
 * by those observations in the same order. Mixed or ambiguous text is kept.
 */
export function packageForAssist(pkg: PackageData): PackageData {
  if (pkg.reconstruction?.current) {
    // Follow-up turns use the saved interpretation as their package context.
    // Retain user corrections and their observation links, but leave the full
    // OCR transcript, image geometry and parser diagnostics in the browser's
    // package record for the inspector and targeted recovery path.
    const reconstruction=pkg.reconstruction;
    const requiredIds=new Set([
      ...reconstruction.identity.evidence.observationIds,
      ...(reconstruction.serving?.evidence.observationIds??[]),
      ...reconstruction.nutritionRows.flatMap(row=>row.evidence.observationIds),
      ...reconstruction.ingredients.flatMap(item=>item.evidence.observationIds),
      ...reconstruction.additives.flatMap(item=>item.evidence.observationIds),
      ...reconstruction.statements.flatMap(item=>item.evidence.observationIds),
      ...reconstruction.unresolved.flatMap(item=>item.evidence.observationIds),
      ...reconstruction.regions.flatMap(region=>region.observationIds),
      ...pkg.observations.filter(observation=>observation.origin==='user').map(observation=>observation.id),
      ...pkg.nutrients.filter(nutrient=>nutrient.status==='corrected').flatMap(nutrient=>nutrient.observationIds),
    ]);
    // Retain the referenced evidence graph so packageSchema can validate every
    // stored reconstruction link, while omitting unrelated OCR lines and bulky
    // word geometry from normal follow-up requests.
    let changed=true;
    while(changed){
      changed=false;
      for(const observation of pkg.observations){
        if(!requiredIds.has(observation.id))continue;
        for(const id of [...(observation.derivedFromObservationIds??[]),...(observation.supersedesObservationIds??[])]){
          if(!requiredIds.has(id)){requiredIds.add(id);changed=true;}
        }
      }
    }
    const compactObservations=pkg.observations.filter(observation=>requiredIds.has(observation.id)).map(observation=>{
      // Keep the run and line order for retained OCR observations. The
      // follow-up no longer needs their boxes or token-level geometry, but
      // the assist boundary still needs the original image/capture lineage.
      const {bbox:_bbox,ocrWords:_ocrWords,visionRunId:_visionRunId,...compact}=observation;
      return compact;
    });
    const retainedImageIds=new Set([
      ...compactObservations.flatMap(observation=>observation.imageId?[observation.imageId]:[]),
      ...reconstruction.regions.map(region=>region.imageId),
      ...[
        reconstruction.identity.evidence,
        ...(reconstruction.serving?[reconstruction.serving.evidence]:[]),
        ...reconstruction.nutritionRows.map(row=>row.evidence),
        ...reconstruction.ingredients.map(item=>item.evidence),
        ...reconstruction.additives.map(item=>item.evidence),
        ...reconstruction.statements.map(item=>item.evidence),
        ...reconstruction.unresolved.map(item=>item.evidence),
      ].flatMap(evidence=>evidence.imageRegions.map(region=>region.imageId)),
    ]);
    const correctedNutrients=pkg.nutrients.filter(nutrient=>nutrient.status==='corrected');
    const {reconstructionHistory:_reconstructionHistory,...currentPackage}=pkg;
    return {
      ...currentPackage,
      name:reconstruction.identity.name??'Unidentified food package',
      ...(reconstruction.identity.brand?{brand:reconstruction.identity.brand}:{}),
      ingredients:[],additives:[],allergens:[],claims:[],
      nutrients:correctedNutrients,
      observations:compactObservations,
      ocrCaptures:(pkg.ocrCaptures??[]).filter(capture=>retainedImageIds.has(capture.imageId)),
      visionCaptures:(pkg.visionCaptures??[]).filter(capture=>retainedImageIds.has(capture.imageId)),
      parserDiagnostics:[],rawText:'',warnings:[]
    };
  }
  const rawOcrLines = pkg.observations.filter(observation => observation.origin === 'ocr' && observation.field === 'ocr-line');
  if (!rawOcrLines.length) return pkg;

  const sourceLines = pkg.rawText.replace(/\r/g, '').split('\n')
    .map(line => line.trim())
    .filter(line => line && !additionalPhotoMarker.test(line));
  if (sourceLines.length !== rawOcrLines.length || sourceLines.some((line, index) => line !== rawOcrLines[index].text)) return pkg;
  return { ...pkg, rawText: '' };
}

function researchCategory(category: string): EvidenceSource['category'] {
  const value = category.toLowerCase();
  if (/guideline|guidance|public health/.test(value)) return 'guideline';
  if (/recall|enforcement|registry|register|candidate match/.test(value)) return 'registry';
  if (/regulation|gazette|amendment|food standard|court|judgment|direction|withdrawal|legal/.test(value)) return 'regulation';
  if (/literature|publication|study|trial|journal|review|cohort|preprint/.test(value)) return 'literature';
  if (/product|catalog|market/.test(value)) return 'product';
  return 'method';
}

function boundedSummary(summary: string): string {
  const value = summary.trim();
  return value.length <= maxSummaryCharacters ? value : `${value.slice(0, maxSummaryCharacters - 1).trimEnd()}…`;
}

/** Build the bounded, attributed evidence context used by an assist request. */
export function assistEvidenceContext({ auditSources, localSearch, research, conversationEvidence = [] }: AssistEvidenceInputs): EvidenceSource[] {
  const result: EvidenceSource[] = [];
  const seen = new Set<string>();
  const add = (source: EvidenceSource) => {
    if (seen.has(source.id) || result.length >= maxAssistSources) return;
    try {
      const url = new URL(source.url);
      if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|127\.|\[::)/.test(url.hostname)) return;
    } catch { return; }
    const parsed = sourceSchema.safeParse({ ...source, summary: boundedSummary(source.summary), limitations: source.limitations.slice(0, 500) });
    if (!parsed.success) return;
    seen.add(parsed.data.id);
    result.push(parsed.data);
  };

  for (const source of auditSources.slice(0, 6)) add(source);
  for (const { score: _score, ...source } of localSearch.slice(0, 3)) add(source);
  for (const item of research.slice(0, 6)) {
    const categoryContext = item.category.trim() ? `Search classification: ${item.category.trim()}\n` : '';
    add({
      id: item.id,
      title: item.title,
      publisher: item.publisher,
      url: item.url,
      category: researchCategory(item.category),
      jurisdiction: 'Not specified by the search result',
      publishedAt: item.publishedAt,
      effectiveAt: item.effectiveAt ?? null,
      retrievedAt: item.retrievedAt,
      summary: `${categoryContext}${item.summary}`,
      limitations: item.limitations,
    });
  }
  for (const source of conversationEvidence.slice(0, 3)) add(source);
  return result;
}
