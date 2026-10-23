import { sourceSchema, type EvidenceSource } from '../contracts';

const snapshotRetrievedAt = '2026-10-23T00:00:00.000Z';

type GuidanceEntry = {
  source: EvidenceSource;
  terms: readonly string[];
  conditions: readonly string[];
  numericCoverage?: {
    queryTerms: readonly string[];
    requiredValuePatterns: readonly string[];
  };
};

export type NutritionGuidanceCoverageFact = {
  sourceId: string;
  statement: string;
  supportingQuote: string;
  requiredValuePatterns: readonly string[];
};

function guidanceSource(value: EvidenceSource): EvidenceSource {
  return sourceSchema.parse(value);
}

const entries: readonly GuidanceEntry[] = [
  {
    source: guidanceSource({
      id: 'ada-standards-diabetes-2026-nutrition',
      title: 'Standards of Care in Diabetes—2026, Section 5: Facilitating Positive Health Behaviors',
      publisher: 'American Diabetes Association',
      url: 'https://diabetesjournals.org/care/article/49/Supplement_1/S89/163932',
      category: 'guideline',
      jurisdiction: 'United States',
      publishedAt: '2026',
      effectiveAt: null,
      retrievedAt: snapshotRetrievedAt,
      summary: 'The 2026 diabetes standards emphasize individualized medical nutrition therapy and culturally appropriate eating patterns; they do not establish one ideal carbohydrate, protein, or fat distribution for every person with diabetes.',
      limitations: 'U.S. clinical guidance. It is not a personal carbohydrate allowance, a product-level safety verdict, or a substitute for an individualized plan with a qualified clinician or dietitian.',
      license: 'Source-linked, NutriScan-authored paraphrase only. Publisher terms are not treated as permission to redistribute guideline text.',
    }),
    terms: ['diabetes', 'prediabetes', 'blood sugar', 'glycemic', 'carbohydrate', 'added sugar', 'meal planning', 'nutrition therapy'],
    conditions: ['diabetes', 'prediabetes'],
  },
  {
    source: guidanceSource({
      id: 'kdigo-ckd-2024-sodium',
      title: 'KDIGO 2024 Clinical Practice Guideline for the Evaluation and Management of Chronic Kidney Disease',
      publisher: 'Kidney Disease: Improving Global Outcomes',
      url: 'https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf',
      category: 'guideline',
      jurisdiction: 'International',
      publishedAt: '2024',
      effectiveAt: null,
      retrievedAt: snapshotRetrievedAt,
      summary: 'For people with CKD, KDIGO suggests dietary sodium below 2 g/day (equivalent to less than 5 g sodium chloride/day); the guideline notes that this restriction is usually inappropriate in sodium-wasting nephropathy.',
      limitations: 'A conditional recommendation for people with CKD, not a universal consumer target. KDIGO notes this restriction is usually inappropriate in sodium-wasting nephropathy. Individual clinical circumstances, age, nutritional status, climate, laboratory results, and treatment matter; a single package label cannot determine daily suitability.',
      license: 'Source-linked, NutriScan-authored paraphrase only. Guideline text and figures are not redistributed.',
    }),
    terms: ['ckd', 'chronic kidney', 'kidney', 'renal', 'sodium', 'salt', 'blood pressure', 'hypertension'],
    conditions: ['ckd', 'chronic kidney disease', 'kidney disease', 'kidney', 'renal'],
    numericCoverage: { queryTerms: ['sodium', 'salt'], requiredValuePatterns: ['\\b2\\s*g(?:rams?)?\\s*(?:\\/|per\\s+)day\\b'] },
  },
  {
    source: guidanceSource({
      id: 'who-healthy-diet-guidance',
      title: 'Healthy diet',
      publisher: 'World Health Organization',
      url: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet',
      category: 'guideline',
      jurisdiction: 'Global',
      publishedAt: null,
      effectiveAt: null,
      retrievedAt: snapshotRetrievedAt,
      summary: 'WHO population guidance covers dietary patterns and the balance of free sugars, sodium, and fats. It describes limits in relation to total daily intake, not as a pass/fail threshold for one packaged food.',
      limitations: 'General population guidance; it does not set an individualized clinical target, estimate a person’s total intake, or determine whether one product is suitable.',
      license: 'Source-linked, NutriScan-authored paraphrase only. No WHO source text is bundled.',
    }),
    terms: ['healthy diet', 'free sugar', 'sugar', 'sodium', 'salt', 'saturated fat', 'trans fat', 'dietary pattern', 'population guidance'],
    conditions: [],
  },
  // ICMR-NIN Dietary Guidelines 2024 is intentionally not searchable until
  // written permission covers electronic use in a product (see docs/DECISIONS.md).
  {
    source: guidanceSource({
      id: 'aha-sodium-guidance-2025',
      title: 'How Much Sodium Should I Eat Per Day?',
      publisher: 'American Heart Association',
      url: 'https://www.heart.org/en/healthy-living/healthy-eating/eat-smart/sodium/how-much-sodium-should-i-eat-per-day',
      category: 'guideline',
      jurisdiction: 'United States',
      publishedAt: '2025-07-15',
      effectiveAt: null,
      retrievedAt: snapshotRetrievedAt,
      summary: 'AHA describes a general adult sodium limit of 2,300 mg/day and an optimal goal of 1,500 mg/day for most adults, while directing people with medical conditions or special restrictions to their care team.',
      limitations: 'U.S. population guidance, not an India-specific target or a personalized prescription. It should not be applied without context to people with kidney disease, unusual sodium losses, or clinician-directed restrictions.',
      license: 'Source-linked, NutriScan-authored paraphrase only. AHA source text is not redistributed.',
    }),
    terms: ['aha', 'american heart association', 'hypertension', 'high blood pressure', 'blood pressure', 'sodium', 'salt'],
    conditions: ['hypertension', 'high blood pressure'],
    numericCoverage: {
      queryTerms: ['sodium', 'salt'],
      requiredValuePatterns: ['\\b2,?300\\s*mg\\s*(?:\\/|per\\s+)day\\b', '\\b1,?500\\s*mg\\s*(?:\\/|per\\s+)day\\b'],
    },
  },
  {
    source: guidanceSource({
      id: 'niddk-ckd-adult-eating',
      title: 'Healthy Eating for Adults with Chronic Kidney Disease',
      publisher: 'National Institute of Diabetes and Digestive and Kidney Diseases',
      url: 'https://www.niddk.nih.gov/health-information/kidney-disease/chronic-kidney-disease-ckd/healthy-eating-adults-chronic-kidney-disease',
      category: 'guideline',
      jurisdiction: 'United States',
      publishedAt: null,
      effectiveAt: null,
      retrievedAt: snapshotRetrievedAt,
      summary: 'NIDDK explains that sodium, potassium, phosphorus, fluids, and protein needs can change with CKD stage and treatment; it advises individualized discussion with a kidney-trained dietitian or health professional.',
      limitations: 'U.S. patient education, not a clinical guideline or a fixed nutrient allowance. Potassium, phosphorus, fluid, and protein targets cannot be inferred from a package or diagnosis alone.',
      license: 'Source-linked, NutriScan-authored paraphrase only; no source page text is bundled.',
    }),
    terms: ['ckd', 'chronic kidney', 'kidney', 'renal', 'potassium', 'phosphorus', 'fluid', 'protein', 'dialysis'],
    conditions: ['ckd', 'chronic kidney disease', 'kidney disease'],
  },
  {
    source: guidanceSource({
      id: 'niddk-celiac-eating-2020',
      title: 'Eating, Diet, & Nutrition for Celiac Disease',
      publisher: 'National Institute of Diabetes and Digestive and Kidney Diseases',
      url: 'https://www.niddk.nih.gov/health-information/digestive-diseases/celiac-disease/eating-diet-nutrition',
      category: 'guideline',
      jurisdiction: 'United States',
      publishedAt: '2020-10',
      effectiveAt: null,
      retrievedAt: snapshotRetrievedAt,
      summary: 'NIDDK describes gluten avoidance as part of care for diagnosed celiac disease and advises medical testing before starting a gluten-free diet when diagnosis is uncertain, because removing gluten may affect test results.',
      limitations: 'Patient education page last reviewed in 2020 and U.S.-based. It does not establish that a particular package is gluten-free or safe from cross-contact; current local labeling rules and the actual package must be checked.',
      license: 'Source-linked, NutriScan-authored paraphrase only; no source page text is bundled.',
    }),
    terms: ['celiac', 'coeliac', 'gluten', 'gluten-free', 'gluten free'],
    conditions: ['celiac disease', 'coeliac disease'],
  },
];

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-IN').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function mentions(text: string, term: string): boolean {
  const normalizedText = ' ' + normalize(text) + ' ';
  const normalizedTerm = normalize(term);
  return normalizedTerm.length > 0 && normalizedText.includes(' ' + normalizedTerm + ' ');
}

function explicitlyNamesSource(query: string, record: EvidenceSource): boolean {
  const normalized = normalize(query);
  const aliases = record.publisher === 'American Heart Association'
    ? ['AHA']
    : record.publisher === 'American Diabetes Association'
      ? ['ADA']
      : [];
  return [record.publisher, record.title, ...aliases]
    .some(value => normalized.includes(normalize(value)));
}

function jurisdictionCompatible(record: EvidenceSource, jurisdiction: string | undefined, explicitSource: boolean): boolean {
  if (!jurisdiction || explicitSource) return true;
  const requested = normalize(jurisdiction);
  const source = normalize(record.jurisdiction);
  if (source === 'global' || source === 'international') return true;
  if (requested === 'india') return source === 'india';
  if (requested === 'united states' || requested === 'us' || requested === 'usa') return source === 'united states';
  return source === requested;
}

export function getNutritionGuidance(input: {
  query: string;
  condition?: string;
  goal?: string;
  jurisdiction?: string;
  maxResults?: number;
}): EvidenceSource[] {
  const query = input.query.trim();
  const contextualText = [query, input.condition ?? '', input.goal ?? ''].filter(Boolean).join(' ');
  const maxResults = Math.max(1, Math.min(5, input.maxResults ?? 3));
  const ranked = entries
    .map(entry => {
      const explicitSource = explicitlyNamesSource(query, entry.source);
      if (!jurisdictionCompatible(entry.source, input.jurisdiction, explicitSource)) return { entry, score: 0 };
      const matchedTerms = entry.terms.filter(term => mentions(contextualText, term));
      const matchedCondition = entry.conditions.some(condition => mentions(contextualText, condition));
      if (entry.conditions.length > 0 && !matchedCondition && !explicitSource) return { entry, score: 0 };
      const score = matchedTerms.length + (matchedCondition ? 3 : 0) + (explicitSource ? 2 : 0);
      return { entry, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.source.id.localeCompare(b.entry.source.id));
  const conditionSpecificIntent = entries.some(entry => entry.conditions.some(condition => mentions(contextualText, condition)));
  const relevant = conditionSpecificIntent
    ? ranked.filter(item => item.entry.conditions.some(condition => mentions(contextualText, condition)) || explicitlyNamesSource(query, item.entry.source))
    : ranked;

  return relevant
    .slice(0, maxResults)
    .map(item => item.entry.source);
}

export function getNutritionGuidanceCoverageFacts(question: string, sourceIds: readonly string[]): NutritionGuidanceCoverageFact[] {
  const directGuidanceQuestion = /\b(guideline|guidance|recommend(?:ation|ed|s)?|according to)\b|\bwhat\s+(?:does\s+)?[\p{L}\p{N}-]+(?:\s+[\p{L}\p{N}-]+){0,2}\s+(?:say|says|recommend|recommends)\b/iu.test(question);
  if (!directGuidanceQuestion) return [];
  const selected = new Set(sourceIds);
  return entries.flatMap(entry => {
    const coverage = entry.numericCoverage;
    if (!coverage || !selected.has(entry.source.id) || !coverage.queryTerms.some(term => mentions(question, term))) return [];
    return [{
      sourceId: entry.source.id,
      statement: entry.source.summary,
      supportingQuote: entry.source.summary,
      requiredValuePatterns: coverage.requiredValuePatterns,
    }];
  });
}
