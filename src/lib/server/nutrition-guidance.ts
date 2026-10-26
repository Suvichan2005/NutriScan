import { sourceSchema, type EvidenceSource } from '../contracts';
import { evidenceSources } from '../knowledge';

const snapshotRetrievedAt = '2026-10-23T00:00:00.000Z';
const currentGuidanceRetrievedAt = '2026-10-25T00:00:00.000Z';

type GuidanceEntry = {
  source: EvidenceSource;
  terms: readonly string[];
  conditions: readonly string[];
  /** Direct topical evidence required before applying a narrow source to a condition. */
  topicTerms?: readonly string[];
  numericCoverage?: {
    queryTerms: readonly string[];
    requiredValuePatterns: readonly string[];
    topicRequirements?: readonly {
      queryTerms: readonly string[];
      requiredValuePatterns: readonly string[];
    }[];
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

function curatedGuidanceSource(id: string): EvidenceSource {
  const source = evidenceSources.find(item => item.id === id);
  if (!source) throw new Error(`Missing curated guidance source: ${id}`);
  return guidanceSource(source);
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
    topicTerms: ['carbohydrate', 'meal planning', 'nutrition therapy'],
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
      summary: 'KDIGO suggests dietary sodium below 2 g/day for people with CKD, equivalent to less than 5 g sodium chloride/day, and notes this restriction is usually inappropriate in sodium-wasting nephropathy. For adults with CKD stages G3–G5, it suggests maintaining protein intake at 0.8 g/kg body weight/day and avoiding intake above 1.3 g/kg/day when at risk of progression; lower-protein diets are only considered for selected people under close supervision. KDIGO advises renal dietitians or accredited nutrition providers to tailor sodium, phosphorus, potassium and protein adaptations to individual needs, CKD severity and comorbidities.',
      limitations: 'These are clinical recommendations for defined CKD populations, not individualized consumer targets or package-level pass/fail thresholds. The 0.8 g/kg/day protein recommendation is for adults with CKD G3–G5; it is not a general target for every person with kidney disease. Very-low-protein diets require close supervision and must not be prescribed for metabolically unstable people. Sodium restriction is usually inappropriate in sodium-wasting nephropathy. The summarized source provides no numerical potassium or phosphorus target; any adaptation depends on individual needs, CKD severity and comorbidities and should be discussed with a renal dietitian or accredited nutrition provider. Age, nutritional status and treatment also affect advice; a single package label cannot determine daily suitability.',
      license: 'Source-linked, NutriScan-authored paraphrase only. Guideline text and figures are not redistributed.',
    }),
    terms: ['ckd', 'chronic kidney', 'kidney', 'renal', 'sodium', 'salt', 'potassium', 'phosphorus', 'blood pressure', 'hypertension'],
    conditions: ['ckd', 'chronic kidney disease', 'kidney disease', 'kidney', 'renal'],
    topicTerms: ['sodium', 'salt', 'protein', 'potassium', 'phosphorus'],
    numericCoverage: {
      queryTerms: ['sodium', 'salt', 'protein'],
      requiredValuePatterns: [],
      topicRequirements: [
        { queryTerms: ['sodium', 'salt'], requiredValuePatterns: ['\\b2\\s*g(?:rams?)?\\s*(?:\\/|per\\s+)day\\b'] },
        { queryTerms: ['protein'], requiredValuePatterns: ['\\b0\\.8\\s*g\\s*\/\\s*kg\\b', '\\b1\\.3\\s*g\\s*\/\\s*kg\\b'] },
      ],
    },
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
  {
    source: curatedGuidanceSource('who-sodium'),
    terms: ['sodium', 'salt', 'sodium reduction', 'sodium intake', 'adult sodium', 'salt intake'],
    conditions: [],
    numericCoverage: {
      queryTerms: ['sodium', 'salt'],
      requiredValuePatterns: ['\\b2,?000\\s*mg\\s*(?:\\/|per\\s+)day\\b', '\\b400\\s*mg\\b'],
    },
  },
  {
    source: guidanceSource({
      id: 'who-free-sugars-guideline-2015',
      title: 'Guideline: sugars intake for adults and children',
      publisher: 'World Health Organization',
      url: 'https://www.who.int/publications/i/item/9789241549028',
      category: 'guideline',
      jurisdiction: 'Global',
      publishedAt: '2015-03-04',
      effectiveAt: null,
      retrievedAt: snapshotRetrievedAt,
      summary: 'WHO recommends reducing free sugars throughout life; for adults and children it recommends less than 10% of total energy, with a further reduction below 5% suggested for additional benefit. WHO defines free sugars to include sugars added by the manufacturer, cook or consumer, and sugars in honey, syrups, fruit juices and concentrates. The guideline focuses on unhealthy weight gain and dental caries; the below-5% recommendation is conditional.',
      limitations: 'Population guidance for total free-sugar intake from all sources, not an individual calorie target or pass/fail test for one product. A package added-sugars declaration is related to this intake but is not itself a total-day free-sugar measure or product-specific allowance.',
      license: 'Source-linked, NutriScan-authored summary only. WHO source text is not bundled.',
    }),
    terms: ['free sugar', 'free sugars', 'added sugar', 'added sugars', 'sugar intake', 'sugars intake', 'sugar', 'sugars'],
    conditions: [],
    numericCoverage: {
      queryTerms: ['free sugar', 'added sugar', 'sugar intake', 'sugars intake', 'sugar', 'sugars'],
      requiredValuePatterns: ['\\b10\\s*%\\b', '\\b5\\s*%\\b'],
    },
  },
  {
    source: guidanceSource({
      id: 'fssai-labelling-rda-reference-viii-2025',
      title: 'Food Safety and Standards (Labelling and Display) Regulations, 2020 — Version VIII',
      publisher: 'Food Safety and Standards Authority of India',
      url: 'https://fssai.gov.in/upload/uploadfiles/files/Comp_Labelling%20Display_Version%20VIII_09_09_2025.pdf',
      category: 'regulation',
      jurisdiction: 'India',
      publishedAt: '2025-09-09',
      effectiveAt: '2022-07-01',
      retrievedAt: currentGuidanceRetrievedAt,
      summary: 'FSSAI Version VIII defines Recommended Dietary Allowance (RDA) as an average daily nutrient intake sufficient for nearly all (97–98%) healthy people in a particular life-stage and gender group, using current Indian Council of Medical Research RDA values and Codex or WHO values where an Indian RDA is unavailable. The nutrition panel provides information per 100 g/ml or per single-consumption pack and per-serve percentage contribution to RDA, using average-adult daily references of 2,000 kcal energy, 67 g total fat, 22 g saturated fat, 2 g trans fat, 50 g added sugars and 2,000 mg sodium. Serving quantity is stated in g/ml and servings per package are declared. These package-label references are not individualized dietary targets.',
      limitations: 'This is an FSSAI label-reference explanation, not a finding that a particular package complies with current law. The linked Version VIII is dated 9 September 2025; FSSAI separately notified a 2026 amendment that commences 1 July 2027 and changes specified label provisions. Check the original notification, the applicable effective date and category-specific rules for compliance questions. The average-adult label basis cannot establish any one person’s needs or total daily intake.',
      license: 'Official FSSAI regulatory compendium; NutriScan stores a short source-linked summary and does not redistribute the source text.',
    }),
    terms: ['rda', 'recommended dietary allowance', 'per serve', 'per serving', 'nutrition label', 'nutrition panel', 'label reference', 'label percentage'],
    conditions: [],
    numericCoverage: {
      queryTerms: ['rda', 'recommended dietary allowance', 'label reference', 'label percentage'],
      requiredValuePatterns: ['\\b97\\s*(?:–|-|to)\\s*98\\s*%(?:\\s|$)', '\\b2,?000\\s*kcal\\b', '\\b67\\s*g\\b', '\\b22\\s*g\\b', '\\b2\\s*g\\b', '\\b50\\s*g\\b', '\\b2,?000\\s*mg\\b'],
    },
  },
  {
    source: guidanceSource({
      id: 'fssai-labelling-amendment-2026',
      title: 'Food Safety and Standards (Labelling and Display) First Amendment Regulations, 2026',
      publisher: 'Food Safety and Standards Authority of India',
      url: 'https://www.fssai.gov.in/upload/notifications/2026/04/69cca2b3f3ce9Notification%20dt%2024.03.2026_NRC.pdf',
      category: 'regulation',
      jurisdiction: 'India',
      publishedAt: '2026-03-24',
      effectiveAt: '2027-07-01',
      retrievedAt: currentGuidanceRetrievedAt,
      summary: 'FSSAI notified this labelling amendment on 24 March 2026 with commencement on 1 July 2027. Among its changes, it specifies that infant-nutrition products may omit per-serve percentage contribution to RDA and servings per pack; it also revises other nutrition and package-label provisions. The amendment is not effective before its stated commencement date.',
      limitations: 'Future-effective amendment. Do not apply its changes before 1 July 2027. The notification changes several provisions; this short summary is not a complete statement of the amendment or a product-compliance determination. Consult the Gazette and product-category rules.',
      license: 'Official Gazette notification; NutriScan stores a short source-linked summary and does not redistribute the source text.',
    }),
    terms: ['infant nutrition', 'infant label', 'rda exemption', 'non-retail container', 'labelling amendment 2026', 'label amendment 2026'],
    conditions: [],
  },
  {
    source: curatedGuidanceSource('who-carbohydrate-2023'),
    terms: ['carbohydrate quality', 'refined wheat flour', 'refined flour', 'whole grain', 'whole grains', 'wholegrain', 'dietary fibre', 'dietary fiber', 'pulses'],
    conditions: [],
  },
  {
    source: guidanceSource({
      id: 'idf-healthy-nutrition-diabetes-2024',
      title: 'Understanding nutrition for diabetes including gestational diabetes and glucose control',
      publisher: 'International Diabetes Federation',
      url: 'https://idf.org/managing-diabetes/healthy-nutrition/',
      category: 'guideline',
      jurisdiction: 'Global',
      publishedAt: '2024-08-20',
      effectiveAt: null,
      retrievedAt: snapshotRetrievedAt,
      summary: 'IDF patient education explains that carbohydrate portions affect blood glucose, refined carbohydrates can raise it more quickly than high-fibre choices, and snack and meal choices should be culturally appropriate and individualized. It suggests options such as nuts, fresh fruit, or unsweetened yoghurt as snacks.',
      limitations: 'Global patient education, last modified 2025-08-20; not a clinical practice guideline, individualized prescription, fixed carbohydrate allowance, or evidence that a particular product is safe or will cause a specific glucose response.',
      license: 'Source-linked, NutriScan-authored paraphrase only; no IDF page text is bundled.',
    }),
    terms: ['diabetes', 'diabetic', 'prediabetes', 'snack', 'snacking', 'carbohydrate', 'refined', 'whole grain', 'wholegrain', 'fibre', 'fiber', 'blood glucose', 'portion'],
    conditions: ['diabetes', 'diabetic', 'prediabetes'],
    topicTerms: ['snack', 'snacking', 'carbohydrate', 'refined', 'whole grain', 'wholegrain', 'fibre', 'fiber', 'blood glucose', 'portion'],
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
    topicTerms: ['sodium', 'salt'],
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
    terms: ['ckd', 'chronic kidney', 'kidney', 'renal', 'sodium', 'salt', 'potassium', 'phosphorus', 'fluid', 'protein', 'dialysis'],
    conditions: ['ckd', 'chronic kidney disease', 'kidney disease'],
    topicTerms: ['sodium', 'salt', 'potassium', 'phosphorus', 'fluid', 'protein', 'dialysis'],
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
    topicTerms: ['gluten', 'gluten-free', 'gluten free'],
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
  const publisherAliases: Record<string, string[]> = {
    'American Heart Association': ['AHA'],
    'American Diabetes Association': ['ADA'],
    'World Health Organization': ['WHO'],
    'Food Safety and Standards Authority of India': ['FSSAI'],
    'National Institute of Diabetes and Digestive and Kidney Diseases': ['NIDDK'],
    'Kidney Disease: Improving Global Outcomes': ['KDIGO'],
  };
  const aliases = publisherAliases[record.publisher] ?? [];
  return [record.publisher, record.title, ...aliases]
    .some(value => normalized.includes(normalize(value)));
}

function jurisdictionCompatible(record: EvidenceSource, jurisdiction: string | undefined, explicitSource: boolean): boolean {
  if (explicitSource) return true;
  const source = normalize(record.jurisdiction);
  if (!jurisdiction) return source === 'global' || source === 'international';
  const requested = normalize(jurisdiction);
  if (/^(?:global|international)(?:\s|$)/.test(source)) return true;
  if (requested === 'india') return /^(?:india|indian)(?:\s|$)/.test(source);
  if (requested === 'united states' || requested === 'us' || requested === 'usa') return /^(?:united states|us|usa)(?:\s|$)/.test(source);
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
      const matchedTerms = entry.terms.filter(term => mentions(contextualText, term));
      if(input.condition&&entry.conditions.length&&!entry.conditions.some(condition=>mentions(input.condition!,condition)))return {entry,score:0,matchedTerms};
      if (!jurisdictionCompatible(entry.source, input.jurisdiction, explicitSource)) return { entry, score: 0, matchedTerms };
      const matchedCondition = entry.conditions.some(condition => mentions(contextualText, condition));
      if (entry.topicTerms?.length && !entry.topicTerms.some(term => mentions(contextualText, term)) && !explicitSource) return { entry, score: 0, matchedTerms };
      if (entry.conditions.length > 0 && !matchedCondition && !explicitSource) return { entry, score: 0, matchedTerms };
      const score = matchedTerms.length + (matchedCondition ? 3 : 0) + (explicitSource ? 2 : 0);
      return { entry, score, matchedTerms };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.source.id.localeCompare(b.entry.source.id));
  const conditionSpecificIntent = entries.some(entry => entry.conditions.some(condition => mentions(contextualText, condition)));
  const relevant = conditionSpecificIntent
    ? ranked.filter(item => item.entry.conditions.some(condition => mentions(contextualText, condition))
      || explicitlyNamesSource(query, item.entry.source) && item.matchedTerms.length > 0
      // General population guidance may complement a condition-specific record
      // when multiple terms match or a declared numeric topic matches directly.
      || item.entry.conditions.length === 0 && (
        item.matchedTerms.length >= 2
        || item.entry.numericCoverage?.queryTerms.some(term => mentions(contextualText, term))
      ))
    : ranked;

  return relevant
    .slice(0, maxResults)
    .map(item => item.entry.source);
}

export function getNutritionGuidanceCoverageFacts(query: string, sourceIds: readonly string[]): NutritionGuidanceCoverageFact[] {
  const selected = new Set(sourceIds);
  return entries.flatMap(entry => {
    const coverage = entry.numericCoverage;
    if (!coverage || !selected.has(entry.source.id)) return [];
    const requiredValuePatterns = coverage.topicRequirements
      ? coverage.topicRequirements
        .filter(group => group.queryTerms.some(term => mentions(query, term)))
        .flatMap(group => group.requiredValuePatterns)
      : coverage.queryTerms.some(term => mentions(query, term))
        ? coverage.requiredValuePatterns
        : [];
    if (requiredValuePatterns.length === 0) return [];
    return [{
      sourceId: entry.source.id,
      statement: entry.source.summary,
      supportingQuote: entry.source.summary,
      requiredValuePatterns,
    }];
  });
}
