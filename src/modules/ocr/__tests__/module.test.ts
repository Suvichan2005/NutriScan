import { describe, expect, it } from 'vitest';
import { parseLabel } from '../parser';
import { selectPaddleFallbackAssets, selectPaddleLanguage, shouldRunPaddleFallback } from '../paddle';
import { summarizeLabelUncertainty } from '../label-uncertainty';
import { captureFixture, noisyLabelFixture, proteinObservationFixture } from '../fixtures/noisy-label';
import type { Observation } from '../../../lib/contracts';

describe('OCR module parsing boundary', () => {
  it('does not promote a confused trans-fat table row into the package identity', () => {
    const line: Observation = { id: 'ocr-trans-fat-row', field: 'ocr-line', text: 'Trans Faty Acids omg', side: 'back', confidence: 96, origin: 'ocr', imageId: 'package-photo' };
    const result = parseLabel(line.text, { origin: 'ocr', observations: [line] });
    expect(result.name).toBe('Unidentified package');
  });

  it('keeps a confused micronutrient row out of the package identity', () => {
    const line: Observation = { id: 'ocr-iron-row', field: 'ocr-line', text: 'lron 4.9mg 1.7mg', side: 'back', confidence: 94, origin: 'ocr', imageId: 'package-photo' };
    const result = parseLabel(line.text, { origin: 'ocr', observations: [line] });
    expect(result.name).toBe('Unidentified package');
  });

  it('does not treat high-confidence back-panel copy as product identity without a front-style source', () => {
    const backLines:Observation[]=[
      {id:'back-name-copy',field:'ocr-line',text:'opram porind threngh scientifie',side:'back',confidence:84.6,origin:'ocr',imageId:'back-photo'},
      {id:'back-energy',field:'ocr-line',text:'Energy (kcal) 384 269',side:'back',confidence:96,origin:'ocr',imageId:'back-photo'},
      {id:'back-protein',field:'ocr-line',text:'Protein (g) 8.2 5.7',side:'back',confidence:96,origin:'ocr',imageId:'back-photo'},
      {id:'back-sodium',field:'ocr-line',text:'Sodium (mg) 1000 700',side:'back',confidence:96,origin:'ocr',imageId:'back-photo'},
    ];
    const backOnly=parseLabel(backLines.map(item=>item.text).join('\n'),{origin:'ocr',observations:backLines});
    expect(backOnly.name).toBe('Unidentified package');
    expect(backOnly.warnings.some(warning=>warning.includes('only in photos that also contain nutrition tables'))).toBe(true);

    const frontName:Observation={id:'front-name',field:'ocr-line',text:'Maggi noodles',side:'front',confidence:96,origin:'ocr',imageId:'front-photo'};
    const withFront=parseLabel([...backLines.map(item=>item.text),frontName.text].join('\n'),{origin:'ocr',observations:[...backLines,frontName]});
    expect(withFront.name).toBe('Maggi noodles');
  });

  it('does not promote a marked nutrient heading to package identity', () => {
    const line:Observation={id:'ocr-marked-sugar-heading',field:'ocr-line',text:'~Total Sugars (g)',side:'back',confidence:96,origin:'ocr',imageId:'package-photo'};
    expect(parseLabel(line.text,{origin:'ocr',observations:[line]}).name).toBe('Unidentified package');
  });

  it('does not present localized nutrition headings or serving columns as product names', () => {
    const lines = ['Contenido energéticc 400 kJ', 'Voedingswaarde per 100g', '100g 15g Par 15g'];
    for (const [index, text] of lines.entries()) {
      const observation: Observation = { id: `ocr-nutrition-heading-${index}`, field: 'ocr-line', text, side: 'back', confidence: 96, origin: 'ocr', imageId: 'package-photo' };
      const result = parseLabel(text, { origin: 'ocr', observations: [observation] });
      expect(result.name).toBe('Unidentified package');
    }
  });

  it('recovers an Indian-style ingredient column from mixed OCR lines using separated table geometry', () => {
    const imageId='geometry-ingredient-photo';
    const runId='geometry-ingredient-run';
    const box=(x0:number,y0:number,x1:number,y1:number)=>({x0,y0,x1,y1});
    const lineSpecs=[
      {regions:[['INGREDIENTS',box(40,10,300,60)],['Total Fat (g)',box(500,10,760,60)]]},
      {regions:[['Noodles: Refined wheat flour',box(40,100,350,140)],['Saturated Fat (g)',box(500,100,760,140)]]},
      {regions:[['Wheat gluten, Thickeners (508)',box(40,200,350,240)],['Sodium (mg)',box(500,200,760,240)]]},
      {regions:[['Masala: Mixed spices',box(40,300,350,340)],['"Iron (mg)',box(500,300,760,340)],['6.90 4.83 16%',box(780,300,950,340)]]},
      {regions:[['Coriander powder, Turmeric powder',box(450,450,900,490)]]},
      {regions:[['Guideline Daily Amounts of an average adult',box(500,500,900,540)]]},
      {regions:[['Allergen Note: Contains Wheat',box(40,700,400,740)]]},
    ];
    const observations:Observation[]=lineSpecs.map((spec,lineIndex)=>{
      let wordIndex=0;
      const ocrWords:NonNullable<Observation['ocrWords']>=spec.regions.flatMap(([text,bbox])=>
        (text as string).split(/\s+/).map(token=>({wordIndex:wordIndex++,text:token,confidence:90,bbox:bbox as ReturnType<typeof box>}))
      );
      return {
        id:`geometry-ingredient-line-${lineIndex}`,
        field:'ocr-line',
        text:spec.regions.map(([text])=>text).join(' '),
        side:'back',
        confidence:90,
        origin:'ocr',
        imageId,
        ocrWords,
        readingOrder:{runId,blockIndex:0,paragraphIndex:0,lineIndex},
      };
    });
    const capture={...captureFixture,runId,imageId,sourceImage:{width:1000,height:1000},preparedImage:{width:1000,height:1000}};
    const result=parseLabel(observations.map(observation=>observation.text).join('\n'),{origin:'ocr',observations,ocrCaptures:[capture]});
    const reconstructed=result.observations.filter(observation=>observation.field==='ingredients');

    expect(result.ingredients).toEqual([
      'Noodles: Refined wheat flour',
      'Wheat gluten, Thickeners (508)',
      'Masala: Mixed spices',
      'Coriander powder, Turmeric powder',
    ]);
    expect(result.ingredients.join(' ')).not.toMatch(/Guideline Daily Amounts|Allergen Note/);
    expect(reconstructed).toHaveLength(4);
    expect(reconstructed.every(observation=>observation.imageId===imageId&&observation.origin==='ocr'&&observation.derivedFromObservationIds?.length===1&&observation.bbox&&observation.readingOrder)).toBe(true);
    expect(observations.every(observation=>observation.ocrWords?.length)).toBe(true);
    expect(result.allergens).toEqual(['Allergen Note: Contains Wheat']);
    expect(result.warnings.join(' ')).toMatch(/separated from mixed OCR lines using a clear label heading and table geometry/i);
  });

  it('abstains from geometric ingredient recovery without multiple separated nutrition rows', () => {
    const imageId='geometry-no-table-photo';
    const runId='geometry-no-table-run';
    const observations:Observation[]=[
      {id:'geometry-no-table-heading',field:'ocr-line',text:'INGREDIENTS',side:'back',confidence:90,origin:'ocr',imageId,ocrWords:[{wordIndex:0,text:'INGREDIENTS',confidence:90,bbox:{x0:20,y0:10,x1:200,y1:40}}],readingOrder:{runId,blockIndex:0,paragraphIndex:0,lineIndex:0}},
      {id:'geometry-no-table-text',field:'ocr-line',text:'Oats, sugar, palm oil',side:'back',confidence:90,origin:'ocr',imageId,ocrWords:[{wordIndex:0,text:'Oats, sugar, palm oil',confidence:90,bbox:{x0:20,y0:60,x1:350,y1:90}}],readingOrder:{runId,blockIndex:0,paragraphIndex:0,lineIndex:1}},
      {id:'geometry-no-table-row',field:'ocr-line',text:'Protein 8 g',side:'back',confidence:90,origin:'ocr',imageId,ocrWords:[{wordIndex:0,text:'Protein',confidence:90,bbox:{x0:500,y0:100,x1:650,y1:130}}],readingOrder:{runId,blockIndex:0,paragraphIndex:0,lineIndex:2}},
    ];
    const capture={...captureFixture,runId,imageId,sourceImage:{width:1000,height:1000},preparedImage:{width:1000,height:1000}};
    const result=parseLabel(observations.map(observation=>observation.text).join('\n'),{origin:'ocr',observations,ocrCaptures:[capture]});

    expect(result.ingredients).toEqual([]);
    expect(result.observations).toEqual(expect.arrayContaining(observations));
  });

  it('withholds OCR-confused Spanish less-than values and serving measures from exact facts and package identity', () => {
    const lines = ['Información Nutrimental', 'Por porción 18 g', '(i cuchara)', 'Fibra dietética Mends de1g'];
    const observations: Observation[] = lines.map((text, index) => ({
      id: `ocr-spanish-qualified-${index}`,
      field: 'ocr-line',
      text,
      side: 'back',
      confidence: 97,
      origin: 'ocr',
      imageId: 'spanish-package-photo',
    }));
    const result = parseLabel(lines.join('\n'), { origin: 'ocr', observations });

    expect(result.name).toBe('Unidentified package');
    expect(result.nutrients.some(nutrient => nutrient.key === 'fiber')).toBe(false);
    expect(result.parserDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'fiber', decision: 'rejected', reasonCodes: expect.arrayContaining(['approximate-or-bounded']) }),
    ]));
    expect(result.observations).toEqual(expect.arrayContaining(observations));
  });

  it('retains a package-level approximate-values qualifier without discarding readable nutrient values', () => {
    const lines = ['NUIRIIIUNALINLUDVK (Approximate Values)', 'Nutrients Per 100 g', 'Total Fat (g) 9.9'];
    const observations: Observation[] = lines.map((text, index) => ({
      id: `approximate-label-${index}`, field: 'ocr-line', text, side: 'back', confidence: 91, origin: 'ocr', imageId: 'approximate-label-photo',
    }));
    const result = parseLabel(lines.join('\n'), { origin: 'ocr', observations });

    expect(result.nutrients).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'fat', value: 9.9, unit: 'g', basis: expect.objectContaining({ amount: 100, unit: 'g' }) }),
    ]));
    expect(result.warnings.join(' ')).toMatch(/labels its nutrition values as approximate/i);
    expect(result.observations).toEqual(expect.arrayContaining(observations));
    expect(summarizeLabelUncertainty(result.parserDiagnostics ?? [], result.warnings).join(' ')).toMatch(/portion calculations use the printed readings as estimates/i);
  });

  it('does not turn a row-level approximate qualifier into a whole-table qualifier', () => {
    const result = parseLabel('Nutrition information per 100 g\nTotal fat approximate values 9.9 g', { origin: 'ocr' });
    expect(result.nutrients.some(nutrient => nutrient.key === 'fat')).toBe(false);
    expect(result.parserDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'fat', decision: 'rejected', reasonCodes: expect.arrayContaining(['approximate-or-bounded']) }),
    ]));
    expect(result.warnings.join(' ')).not.toMatch(/labels its nutrition values as approximate/i);
  });

  it.each([
    ['Par 100 g', 'Énergie 420 kcal', 'Protéines 10 g', 'Glucides 55 g'],
    ['Por 100 g', 'Energía 420 kcal', 'Proteínas 10 g', 'Hidratos de carbono 55 g'],
  ])('associates localized per-basis headings with French and Spanish nutrient rows', (...lines) => {
    const result = parseLabel(lines.join('\n'), { origin: 'user' });
    expect(result.nutrients).toHaveLength(3);
    expect(result.nutrients.every(nutrient => nutrient.basis?.amount === 100 && nutrient.basis.unit === 'g')).toBe(true);
    expect(result.nutrients.map(nutrient => nutrient.key)).toEqual(expect.arrayContaining(['energy', 'protein', 'carbohydrate']));
    expect(result.nutrients.every(nutrient => nutrient.status === 'observed')).toBe(true);
  });

  it('routes the local recovery model from first-pass package language and defaults uncertain text to English', () => {
    const observations = (lines: string[]) => lines.map((text, index): Observation => ({
      id: `language-line-${index}`, field: 'ocr-line', text, side: 'back', confidence: 90, origin: 'ocr', imageId: 'language-photo'
    }));
    expect(selectPaddleLanguage(observations([
      'Información nutricional', 'Por porción 18 g', 'Contenido energético 400 kJ', 'Grasas', 'Carbohidratos', 'Azúcares', 'Sodio'
    ]), 'language-photo')).toBe('es');
    expect(selectPaddleLanguage(observations([
      'Valeurs nutritionnelles', 'Pour 100 g', 'Énergie 539 kcal', 'Matières grasses', 'Glucides', 'Sucres', 'Protéines', 'Sel'
    ]), 'language-photo')).toBe('fr');
    expect(selectPaddleLanguage(observations(['Nutrition information per 100 g', 'Energy 420 kcal', 'Protein 10 g']), 'language-photo')).toBe('en');
    expect(selectPaddleLanguage([], 'language-photo')).toBe('en');
  });

  it('selects a bounded package-panel fallback only when the first read leaves useful fields unresolved', () => {
    const complete = parseLabel([
      'North Mill',
      'Nutrition information per 100 g',
      'Energy 420 kcal',
      'Carbohydrate 65 g',
      'Total sugars 2 g',
      'Protein 10 g',
      'Total fat 15 g',
      'Saturated fat 3 g',
      'Sodium 850 mg'
    ].join('\n'), { origin: 'ocr', observations: [{ id: 'known-package-name', field: 'ocr-line', text: 'North Mill', side: 'front', confidence: 95, origin: 'ocr', imageId: 'front-photo' }] });
    const incomplete = parseLabel('Nutrition information per 100 g\nEnergy 420 kcal', { origin: 'ocr' });
    const panel = { id: 'panel', side: 'back', role: 'nutrition', name: 'Nutrition panel', blob: new Blob(), url: '', width: 1000, height: 800 } as const;
    const front = { ...panel, id: 'front', side: 'front', role: 'front' } as const;

    expect(shouldRunPaddleFallback(complete, [front])).toBe(false);
    expect(shouldRunPaddleFallback(incomplete, [panel])).toBe(true);
    expect(selectPaddleFallbackAssets([front, panel], [])).toEqual([panel]);
  });

  it('checks one front photo with the secondary reader when the nutrition table is usable but identity is missing', () => {
    const completeWithoutIdentity = parseLabel([
      'Nutrition information per 100 g',
      'Energy 420 kcal',
      'Carbohydrate 65 g',
      'Total sugars 2 g',
      'Protein 10 g',
      'Total fat 15 g',
      'Saturated fat 3 g',
      'Sodium 850 mg'
    ].join('\n'), { origin: 'ocr' });
    const panel = { id: 'panel', side: 'back', role: 'nutrition', name: 'Nutrition panel', blob: new Blob(), url: '', width: 1000, height: 800 } as const;
    const front = { ...panel, id: 'front', side: 'front', role: 'front' } as const;

    expect(completeWithoutIdentity.name).toBe('Unidentified package');
    expect(shouldRunPaddleFallback(completeWithoutIdentity, [panel, front])).toBe(true);
    expect(selectPaddleFallbackAssets([panel, front], [], true)).toEqual([panel, front]);
    const unhintedFront = { ...front, id: 'unhinted-front', side: 'extra', role: 'unknown' } as const;
    const unhintedPanel = { ...panel, id: 'unhinted-panel', side: 'extra', role: 'unknown' } as const;
    expect(shouldRunPaddleFallback(completeWithoutIdentity, [unhintedFront, unhintedPanel])).toBe(true);
    expect(selectPaddleFallbackAssets([unhintedFront, unhintedPanel], [], true)).toEqual([unhintedFront, unhintedPanel]);
  });

  it('retains original OCR lines while parsing only unambiguous structured values', () => {
    const result = parseLabel(noisyLabelFixture, {
      origin: 'ocr',
      observations: [proteinObservationFixture],
      ocrCaptures: [captureFixture]
    });

    expect(result.observations).toContainEqual(expect.objectContaining({
      id: 'ocr-protein-1',
      field: 'ocr-line',
      text: 'Protein 8.8 g',
      imageId: 'fixture-image-1',
      readingOrder: proteinObservationFixture.readingOrder
    }));
    expect(result.nutrients).toContainEqual(expect.objectContaining({ key: 'protein', value: 8.8, unit: 'g', basis: { amount: 100, unit: 'g', description: 'per 100 g' } }));
    expect(result.nutrients.some(nutrient => nutrient.key === 'protein' && nutrient.status === 'conflict')).toBe(true);
    expect(result.parserDiagnostics?.some(diagnostic => diagnostic.field === 'protein' && diagnostic.reasonCodes.includes('multiple-values'))).toBe(true);
    expect(result.observations.some(observation => observation.field === 'additive:955')).toBe(false);
  });

  it('accepts an app-supplied identity resolver without importing the knowledge module', () => {
    const result = parseLabel('Ingredients: oats, sweetener (INS 955)', {
      origin: 'user',
      resolveAdditives: () => ['955']
    });
    expect(result.observations.some(observation => observation.field === 'additive:955')).toBe(true);
  });

  it('recovers an explicitly-unitized nutrient from a noisy multi-column OCR row only when word geometry aligns it to one basis', () => {
    const runId = 'geometry-run-1';
    const imageId = 'geometry-image-1';
    const capture = {
      ...captureFixture,
      runId,
      imageId,
      sourceImage: { width: 1000, height: 500 },
      preparedImage: { width: 1000, height: 500 }
    } as const;
    const header: Observation = {
      id: 'ocr-header-1', field: 'ocr-line', text: 'Nutrients Per 100g# Pec 359%', side: 'back', confidence: 78, origin: 'ocr', imageId,
      bbox: { x0: 50, y0: 20, x1: 830, y1: 42 },
      ocrWords: [
        { wordIndex: 0, text: 'Nutrients', confidence: 94, bbox: { x0: 50, y0: 20, x1: 190, y1: 42 } },
        { wordIndex: 1, text: 'Per', confidence: 80, bbox: { x0: 600, y0: 20, x1: 645, y1: 42 } },
        { wordIndex: 2, text: '100g#', confidence: 29, bbox: { x0: 650, y0: 20, x1: 690, y1: 42 } },
        { wordIndex: 3, text: 'Pec', confidence: 59, bbox: { x0: 735, y0: 20, x1: 770, y1: 42 } },
        { wordIndex: 4, text: '359%', confidence: 22, bbox: { x0: 780, y0: 20, x1: 830, y1: 42 } }
      ],
      readingOrder: { runId, blockIndex: 0, paragraphIndex: 0, lineIndex: 0 }
    };
    const sugar: Observation = {
      id: 'ocr-sugar-1', field: 'ocr-line', text: 'RK   Sugar                      0g           0g', side: 'back', confidence: 53, origin: 'ocr', imageId,
      bbox: { x0: 100, y0: 100, x1: 820, y1: 122 },
      ocrWords: [
        { wordIndex: 0, text: 'RK', confidence: 0, bbox: { x0: 100, y0: 100, x1: 120, y1: 122 } },
        { wordIndex: 1, text: 'Sugar', confidence: 57, bbox: { x0: 130, y0: 100, x1: 200, y1: 122 } },
        { wordIndex: 2, text: '0g', confidence: 96, bbox: { x0: 600, y0: 100, x1: 620, y1: 122 } },
        { wordIndex: 3, text: '0g', confidence: 72, bbox: { x0: 800, y0: 100, x1: 820, y1: 122 } }
      ],
      readingOrder: { runId, blockIndex: 0, paragraphIndex: 0, lineIndex: 1 }
    };

    const result = parseLabel(`${header.text}\n${sugar.text}`, { origin: 'ocr', observations: [header, sugar], ocrCaptures: [capture] });

    expect(result.nutrients.filter(nutrient => nutrient.key === 'sugars')).toEqual([
      expect.objectContaining({ key: 'sugars', value: 0, unit: 'g', basis: expect.objectContaining({ amount: 100, unit: 'g' }), status: 'observed' })
    ]);
    expect(result.observations.find(observation => observation.id === 'ocr-sugar-1')?.ocrWords).toEqual(sugar.ocrWords);
    expect(result.parserDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'sugars', decision: 'accepted', reasonCodes: ['multiple-values'],
        numericCandidates: [{ rawValueText: '0', value: 0, unit: 'g' }, { rawValueText: '0', value: 0, unit: 'g' }]
      })
    ]));
    expect(result.warnings.some(warning => warning.includes('other row values remain unassigned'))).toBe(true);

    const unitlessSugar: Observation = {
      ...sugar,
      id: 'ocr-sugar-unitless-1',
      text: 'RK   Sugar                      0           0',
      ocrWords: sugar.ocrWords?.map((word, index) => index < 2 ? word : { ...word, text: '0' })
    };
    const unitless = parseLabel(`${header.text}\n${unitlessSugar.text}`, { origin: 'ocr', observations: [header, unitlessSugar], ocrCaptures: [capture] });
    expect(unitless.nutrients.some(nutrient => nutrient.key === 'sugars')).toBe(false);
    expect(unitless.parserDiagnostics?.find(diagnostic => diagnostic.field === 'sugars')).toMatchObject({ decision: 'rejected', reasonCodes: expect.arrayContaining(['missing-unit']) });
  });

  it('keeps multi-value rows conflicted when the OCR basis has no usable matching geometry', () => {
    const result = parseLabel('Nutrition information per 100 g\nSugar 0 g 0 g', { origin: 'user' });
    expect(result.nutrients.filter(nutrient => nutrient.key === 'sugars')).toHaveLength(2);
    expect(result.nutrients.filter(nutrient => nutrient.key === 'sugars').every(nutrient => nutrient.status === 'conflict' && nutrient.basis === null)).toBe(true);
  });

  it('reconstructs both numeric columns only when OCR values align one-to-one with the printed bases', () => {
    const runId = 'two-column-run';
    const imageId = 'two-column-image';
    const capture = { ...captureFixture, runId, imageId, sourceImage: { width: 1000, height: 500 }, preparedImage: { width: 1000, height: 500 } } as const;
    const header: Observation = {
      id: 'two-column-header', field: 'ocr-line', text: 'Nutrients Per 100 g Per 35 g', side: 'back', confidence: 94, origin: 'ocr', imageId,
      bbox: { x0: 80, y0: 20, x1: 850, y1: 42 },
      ocrWords: [
        { wordIndex: 0, text: 'Nutrients', confidence: 96, bbox: { x0: 80, y0: 20, x1: 220, y1: 42 } },
        { wordIndex: 1, text: 'Per', confidence: 96, bbox: { x0: 500, y0: 20, x1: 545, y1: 42 } },
        { wordIndex: 2, text: '100', confidence: 96, bbox: { x0: 550, y0: 20, x1: 580, y1: 42 } },
        { wordIndex: 3, text: 'g', confidence: 96, bbox: { x0: 583, y0: 20, x1: 595, y1: 42 } },
        { wordIndex: 4, text: 'Per', confidence: 96, bbox: { x0: 720, y0: 20, x1: 765, y1: 42 } },
        { wordIndex: 5, text: '35', confidence: 96, bbox: { x0: 770, y0: 20, x1: 795, y1: 42 } },
        { wordIndex: 6, text: 'g', confidence: 96, bbox: { x0: 798, y0: 20, x1: 810, y1: 42 } }
      ],
      readingOrder: { runId, blockIndex: 0, paragraphIndex: 0, lineIndex: 0 }
    };
    const sugar: Observation = {
      id: 'two-column-sugar', field: 'ocr-line', text: 'Sugar 0 g 0 g', side: 'back', confidence: 96, origin: 'ocr', imageId,
      bbox: { x0: 80, y0: 60, x1: 780, y1: 82 },
      ocrWords: [
        { wordIndex: 0, text: 'Sugar', confidence: 96, bbox: { x0: 80, y0: 60, x1: 180, y1: 82 } },
        { wordIndex: 1, text: '0', confidence: 96, bbox: { x0: 510, y0: 60, x1: 530, y1: 82 } },
        { wordIndex: 2, text: 'g', confidence: 96, bbox: { x0: 533, y0: 60, x1: 545, y1: 82 } },
        { wordIndex: 3, text: '0', confidence: 96, bbox: { x0: 730, y0: 60, x1: 750, y1: 82 } },
        { wordIndex: 4, text: 'g', confidence: 96, bbox: { x0: 753, y0: 60, x1: 765, y1: 82 } }
      ],
      readingOrder: { runId, blockIndex: 0, paragraphIndex: 0, lineIndex: 1 }
    };

    const result = parseLabel(`${header.text}\n${sugar.text}`, { origin: 'ocr', observations: [header, sugar], ocrCaptures: [capture] });
    const recovered = result.nutrients.filter(nutrient => nutrient.key === 'sugars');
    expect(recovered).toEqual([
      expect.objectContaining({ key: 'sugars', value: 0, unit: 'g', basis: expect.objectContaining({ amount: 100, unit: 'g' }), status: 'observed' }),
      expect.objectContaining({ key: 'sugars', value: 0, unit: 'g', basis: expect.objectContaining({ amount: 35, unit: 'g' }), status: 'observed' })
    ]);
    expect(recovered.every(nutrient => nutrient.observationIds.some(id => result.observations.find(observation => observation.id === id)?.derivedFromObservationIds?.includes('two-column-header')))).toBe(true);
    expect(result.parserDiagnostics?.find(diagnostic => diagnostic.field === 'sugars')).toMatchObject({ decision: 'accepted', basisCandidates: [{ amount: 100, unit: 'g' }, { amount: 35, unit: 'g' }] });

    const oneValue: Observation = { ...sugar, id: 'two-column-sugar-one-value', text: 'Sugar 0 g', ocrWords: sugar.ocrWords?.slice(0, 3) };
    const unresolved = parseLabel(`${header.text}\n${oneValue.text}`, { origin: 'ocr', observations: [header, oneValue], ocrCaptures: [capture] });
    expect(unresolved.nutrients.filter(nutrient => nutrient.key === 'sugars').every(nutrient => nutrient.status === 'conflict' && nutrient.basis === null)).toBe(true);
  });

  it('reconstructs an explicitly stacked serving table and splits a fused number only when header geometry identifies both columns', () => {
    const runId='indian-stacked-table-run';
    const imageId='indian-stacked-table-photo';
    const capture={...captureFixture,runId,imageId,sourceImage:{width:1844,height:4096},preparedImage:{width:1351,height:3000}} as const;
    const lines=[
      'If a serve is 70 g',
      'NUTRITION Per | Per | %GDA*',
      'INFORMATION 100 g serve Per serve',
      'n energy, ,13% total Energy (kcal) 384 269 13%',
      'ted fat, 5% Protein (g) 8.2 5.7 11%',
      '5% sodium. Carbohydrate (g) 59.6 41.7 16%',
      'es -Total Sugars (g) 1.8 1.3 1%',
      'g* -Added Sugars (g) 1.1 0.8',
      'S Total Fat (g) 12.5 8.8 13%',
      'wheat flour -Saturated Fat (g)(not more than) 8.2 5.8 29%',
      'odized salt, -Trans Fat (g) (not more than) 0.130.10',
      'eners(508 &) Sodium (mg) 1000.0700.0 29%',
      'per serve %RDA'
    ];
    const observations:Observation[]=lines.map((text,index)=>({
      id:`indian-stacked-${index}`,field:'ocr-line',text,side:'back',confidence:90,origin:'ocr',imageId,
      bbox:{x0:0,y0:index*30,x1:900,y1:index*30+24},
      readingOrder:{runId,blockIndex:0,paragraphIndex:0,lineIndex:index}
    }));
    const setWordBoxes=(lineIndex:number,items:Array<{text:string;x0:number;x1:number}>,y:number)=>{
      const observation=observations[lineIndex];
      observation.ocrWords=items.map((item,wordIndex)=>({wordIndex,text:item.text,confidence:96,bbox:{x0:item.x0,y0:y,x1:item.x1,y1:y+24}}));
      observation.bbox={x0:Math.min(...items.map(item=>item.x0)),y0:y,x1:Math.max(...items.map(item=>item.x1)),y1:y+24};
    };
    setWordBoxes(1,[
      {text:'NUTRITION',x0:263,x1:572},{text:'Per',x0:781,x1:866},{text:'Per',x0:888,x1:966},{text:'%GDA*',x0:978,x1:1104}
    ],1130);
    setWordBoxes(2,[
      {text:'INFORMATION',x0:265,x1:594},{text:'100g',x0:767,x1:882},{text:'serve',x0:877,x1:983},{text:'Per',x0:968,x1:1103},{text:'serve',x0:968,x1:1103}
    ],1200);
    setWordBoxes(11,[
      {text:'eners(508',x0:0,x1:232},{text:'&',x0:0,x1:232},{text:'Sodium',x0:241,x1:489},{text:'(mg)',x0:241,x1:489},
      {text:'1000.0700.0',x0:757,x1:973},{text:'29%',x0:969,x1:1068}
    ],1920);
    const result=parseLabel(lines.join('\n'),{origin:'ocr',observations,ocrCaptures:[capture]});

    expect(result.name).toBe('Unidentified package');
    expect(result.serving).toEqual({value:70,unit:'g'});
    expect(result.nutrients.filter(nutrient=>nutrient.key==='energy')).toEqual([
      expect.objectContaining({value:384,unit:'kcal',basis:expect.objectContaining({amount:100,unit:'g'}),status:'observed'}),
      expect.objectContaining({value:269,unit:'kcal',basis:expect.objectContaining({amount:70,unit:'g'}),status:'observed'})
    ]);
    expect(result.nutrients.filter(nutrient=>nutrient.key==='protein')).toEqual([
      expect.objectContaining({value:8.2,unit:'g',basis:expect.objectContaining({amount:100,unit:'g'}),status:'observed'}),
      expect.objectContaining({value:5.7,unit:'g',basis:expect.objectContaining({amount:70,unit:'g'}),status:'observed'})
    ]);
    expect(result.nutrients.filter(nutrient=>nutrient.key==='carbohydrate').map(nutrient=>nutrient.value)).toEqual([59.6,41.7]);
    expect(result.nutrients.filter(nutrient=>nutrient.key==='sugars').map(nutrient=>nutrient.value)).toEqual([1.8,1.3]);
    expect(result.nutrients.filter(nutrient=>nutrient.key==='addedSugars').map(nutrient=>nutrient.value)).toEqual([1.1,0.8]);
    expect(result.nutrients.filter(nutrient=>nutrient.key==='fat'&&nutrient.status==='observed').map(nutrient=>nutrient.value)).toEqual([12.5,8.8]);
    expect(result.nutrients.filter(nutrient=>nutrient.key==='saturatedFat').map(nutrient=>nutrient.value)).toEqual([8.2,5.8]);
    expect(result.nutrients.filter(nutrient=>nutrient.key==='fat'&&nutrient.status==='conflict').every(nutrient=>nutrient.basis===null)).toBe(true);
    expect(result.nutrients.filter(nutrient=>nutrient.key==='sodium')).toEqual([
      expect.objectContaining({value:1000,unit:'mg',basis:expect.objectContaining({amount:100,unit:'g'}),status:'observed'}),
      expect.objectContaining({value:700,unit:'mg',basis:expect.objectContaining({amount:70,unit:'g'}),status:'observed'})
    ]);
    expect(result.observations.some(observation=>observation.id==='indian-stacked-1')).toBe(true);
    expect(result.observations.some(observation=>observation.id==='indian-stacked-2')).toBe(true);
    expect(result.nutrients.filter(nutrient=>nutrient.key==='energy').every(nutrient=>nutrient.observationIds.includes('indian-stacked-2'))).toBe(true);
    expect(result.parserDiagnostics?.find(diagnostic=>diagnostic.field==='energy')).toMatchObject({decision:'accepted',basisCandidates:[
      {amount:100,unit:'g',description:'per 100 g (split table header)'},
      {amount:70,unit:'g',description:'per declared serving (split table header)'}
    ]});
    expect(result.warnings.some(warning=>warning.includes('cell-level geometry was unavailable'))).toBe(true);
    const fusedCandidate=result.observations.find(observation=>observation.field==='nutrition-row-candidate'&&observation.derivedFromObservationIds?.includes('indian-stacked-11'));
    expect(fusedCandidate?.text).toContain('1000.0 700.0');
    expect(result.observations.find(observation=>observation.id==='indian-stacked-11')?.text).toContain('1000.0700.0');
    expect(result.warnings.some(warning=>warning.includes('fused numeric token was split'))).toBe(true);

    const withoutGeometry=observations.map(observation=>({...observation,ocrWords:undefined}));
    const conservative=parseLabel(lines.join('\n'),{origin:'ocr',observations:withoutGeometry,ocrCaptures:[capture]});
    expect(conservative.nutrients.filter(nutrient=>nutrient.key==='sodium').every(nutrient=>nutrient.status!=='observed'||nutrient.basis===null)).toBe(true);
    expect(conservative.observations.find(observation=>observation.id==='indian-stacked-11')?.text).toContain('1000.0700.0');

    const textOnly=parseLabel('If a serve is 70 g',{origin:'user'});
    expect(textOnly.serving).toEqual({value:70,unit:'g'});
    expect(textOnly.name).toBe('Unidentified package');
  });

  it('reconstructs a curved table from ordered OCR columns and abstains when one column is incomplete', () => {
    const runId = 'curved-table-run';
    const imageId = 'curved-table-image';
    const capture = { ...captureFixture, runId, imageId, sourceImage: { width: 1000, height: 1800 }, preparedImage: { width: 1000, height: 1800 } } as const;
    let lineIndex = 0;
    const box = (id: string, text: string, x: number, y: number, tokens=text.split(/\s+/)): Observation => {
      const ocrWords = tokens.map((token, index) => ({
        wordIndex: index, text: token, confidence: 96,
        bbox: { x0: x + index * 34, y0: y, x1: x + index * 34 + Math.max(24, token.length * 9), y1: y + 24 }
      }));
      return {
        id, field: 'ocr-line', text, side: 'back', confidence: 96, origin: 'ocr', imageId,
        bbox: { x0: Math.min(...ocrWords.map(word => word.bbox.x0)), y0: y, x1: Math.max(...ocrWords.map(word => word.bbox.x1)), y1: y + 24 },
        ocrWords,
        readingOrder: { runId, blockIndex: 0, paragraphIndex: 0, lineIndex: lineIndex++ }
      };
    };
    const header=box(
      'curved-header','Nutrients Per 100 g Per 35 g',80,200,
      ['Nutrients','Per','100','g','Per','35','g']
    );
    const headerXs=[80,420,460,490,720,760,790];
    header.ocrWords=header.ocrWords?.map((word,index)=>({...word,bbox:{...word.bbox,x0:headerXs[index],x1:headerXs[index]+Math.max(24,word.text.length*9)}}));
    if(header.ocrWords?.length)header.bbox={x0:80,y0:200,x1:820,y1:224};
    const source: Observation[] = [header];
    const rows = [
      { label: 'Energy', key: 'energy' as const, left: '410kcal', right: '123kcal', labelY: 500, leftY: 460, rightY: 440 },
      { label: 'Protein', key: 'protein' as const, left: '14g', right: '4.2g', labelY: 650, leftY: 610, rightY: 590 },
      { label: 'Carbohydrate', key: 'carbohydrate' as const, left: '66g', right: '19.8g', labelY: 800, leftY: 760, rightY: 740 },
      { label: 'Total fat', key: 'fat' as const, left: '8g', right: '2.4g', labelY: 1100, leftY: 1180, rightY: 1160 },
      { label: 'Sodium', key: 'sodium' as const, left: '300mg', right: '105mg', labelY: 1250, leftY: 1330, rightY: 1310 }
    ];
    for (const [index,row] of rows.entries()) {
      source.push(box(`curved-label-${index}`,row.label,80,row.labelY));
      source.push(box(`curved-left-${index}`,row.left,440,row.leftY));
      source.push(box(`curved-right-${index}`,row.right,740,row.rightY));
    }
    const input = source.sort((a,b)=>(a.bbox?.y0??0)-(b.bbox?.y0??0)||a.id.localeCompare(b.id));
    const text = input.map(observation=>observation.text).join('\n');
    const result = parseLabel(text,{origin:'ocr',observations:input,ocrCaptures:[capture]});

    for (const [index,row] of rows.entries()) {
      expect(result.nutrients).toContainEqual(expect.objectContaining({key:row.key,value:Number.parseFloat(row.left),basis:expect.objectContaining({amount:100,unit:'g'}),status:'observed'}));
      expect(result.nutrients).toContainEqual(expect.objectContaining({key:row.key,value:Number.parseFloat(row.right),basis:expect.objectContaining({amount:35,unit:'g'}),status:'observed'}));
      const candidate=result.observations.find(observation=>observation.field==='nutrition-row-candidate'&&observation.derivedFromObservationIds?.includes(`curved-label-${index}`));
      expect(candidate?.derivedFromObservationIds).toEqual(expect.arrayContaining([`curved-left-${index}`,`curved-right-${index}`]));
    }
    expect(result.rawText).toBe(text);
    expect(result.observations.map(observation=>observation.id)).toEqual(expect.arrayContaining(source.map(observation=>observation.id)));
    expect(result.parserDiagnostics?.filter(diagnostic=>diagnostic.field==='energy'||diagnostic.field==='protein'||diagnostic.field==='carbohydrate'||diagnostic.field==='fat'||diagnostic.field==='sodium').every(diagnostic=>diagnostic.decision==='accepted')).toBe(true);

    const coarseHeader={...header,ocrWords:header.ocrWords?.map(word=>({...word,bbox:{x0:400,y0:200,x1:820,y1:224}})),bbox:{x0:400,y0:200,x1:820,y1:224}};
    const coarseSource=source.map(observation=>observation.id==='curved-header'?coarseHeader:observation.id.startsWith('curved-left-')?{
      ...observation,
      bbox:observation.bbox&&{...observation.bbox,x0:observation.bbox.x0+160,x1:observation.bbox.x1+160},
      ocrWords:observation.ocrWords?.map(word=>({...word,bbox:{...word.bbox,x0:word.bbox.x0+160,x1:word.bbox.x1+160}})),
    }:observation);
    const coarseText=coarseSource.sort((a,b)=>(a.bbox?.y0??0)-(b.bbox?.y0??0)||a.id.localeCompare(b.id)).map(observation=>observation.text).join('\n');
    const coarseResult=parseLabel(coarseText,{origin:'ocr',observations:coarseSource,ocrCaptures:[capture]});
    expect(coarseResult.observations.filter(observation=>observation.field==='nutrition-row-candidate')).toHaveLength(5);

    const incompleteSource=input.filter(observation=>observation.id!=='curved-right-4');
    const incompleteText=incompleteSource.map(observation=>observation.text).join('\n');
    const incomplete=parseLabel(incompleteText,{origin:'ocr',observations:incompleteSource,ocrCaptures:[capture]});
    expect(incomplete.observations.some(observation=>observation.field==='nutrition-row-candidate')).toBe(false);
    expect(incomplete.nutrients).toHaveLength(0);
    expect(incomplete.observations).toEqual(expect.arrayContaining(incompleteSource.map(observation=>expect.objectContaining({id:observation.id}))));
  });

  it('recovers localized serving bases and a parenthetical kcal value from Spanish label text', () => {
    const result=parseLabel([
      'Información nutricional',
      'Por porción 18 g (1 cucharada)',
      'Contenido energético 400 kJ (100 kcal)',
      'Proteínas 1 g',
      'Grasas (lípidos) 6 g',
      'Grasa saturada 2 g',
      'Carbohidratos 10 g',
      'Azúcares 1.2 g',
      'Fibra dietética 0.1 g',
      'Sodio 10 mg'
    ].join('\n'),{origin:'user'});

    expect(result.serving).toEqual({value:18,unit:'g'});
    expect(result.nutrients.map(nutrient=>nutrient.key)).toEqual(expect.arrayContaining([
      'energy','protein','fat','saturatedFat','carbohydrate','sugars','fiber','sodium'
    ]));
    expect(result.nutrients).toContainEqual(expect.objectContaining({key:'energy',value:100,unit:'kcal',basis:expect.objectContaining({amount:18,unit:'g'}),status:'observed'}));
    expect(result.nutrients.every(nutrient=>nutrient.basis?.amount===18&&nutrient.basis.unit==='g'&&nutrient.status==='observed')).toBe(true);
    expect(result.parserDiagnostics?.find(diagnostic=>diagnostic.field==='energy')).toMatchObject({
      decision:'accepted',numericCandidates:[{rawValueText:'400',value:400,unit:'kj'},{rawValueText:'100',value:100,unit:'kcal'}]
    });
  });

  it('recovers the printed serving measure from a noisy Indian-package OCR line and links its source', () => {
    const source:Observation={
      id:'saffola-serving-measure-line',field:'ocr-line',text:'No. of Servings per pack: , Serveasure: 38 g (/2 cup)',
      side:'back',confidence:88,origin:'ocr',imageId:'saffola-photo',
    };
    const result=parseLabel(source.text,{origin:'ocr',observations:[source]});
    expect(result.serving).toEqual({value:38,unit:'g'});
    expect(result.observations).toContainEqual(expect.objectContaining({
      field:'serving',text:'Serveasure: 38 g',origin:'ocr',imageId:'saffola-photo',derivedFromObservationIds:[source.id],
    }));

    const countOnly=parseLabel('No. of Servings per pack: 1\nPer 100 g',{origin:'user'});
    expect(countOnly.serving).toBeUndefined();
  });

  it('reconstructs energy sub-rows and a separate unit column using same-image geometry', () => {
    const runId='separate-unit-column-run';
    const imageId='separate-unit-column-image';
    const capture={...captureFixture,runId,imageId,sourceImage:{width:1000,height:1100},preparedImage:{width:1000,height:1100}} as const;
    let lineIndex=0;
    const line=(id:string,text:string,words:Array<{text:string;x:number;y:number;width?:number}>) : Observation=>{
      const ocrWords=words.map((word,wordIndex)=>({
        wordIndex,text:word.text,confidence:96,
        bbox:{x0:word.x,y0:word.y,x1:word.x+(word.width??Math.max(10,word.text.length*9)),y1:word.y+20}
      }));
      return {
        id,field:'ocr-line',text,side:'back',confidence:96,origin:'ocr',imageId,
        bbox:{x0:Math.min(...ocrWords.map(word=>word.bbox.x0)),y0:Math.min(...ocrWords.map(word=>word.bbox.y0)),x1:Math.max(...ocrWords.map(word=>word.bbox.x1)),y1:Math.max(...ocrWords.map(word=>word.bbox.y1))},
        ocrWords,readingOrder:{runId,blockIndex:0,paragraphIndex:0,lineIndex:lineIndex++}
      };
    };
    const header=line('unit-table-header','Valeurs nutritionnelles Pour 100 g Par portion 15 g %*',[
      {text:'Valeurs',x:60,y:100,width:70},{text:'nutritionnelles',x:135,y:100,width:130},
      {text:'Pour',x:565,y:100,width:36},{text:'100',x:603,y:100,width:30},{text:'g',x:635,y:100,width:12},
      {text:'Par',x:765,y:100,width:24},{text:'portion',x:792,y:100,width:60},{text:'15',x:854,y:100,width:18},{text:'g',x:874,y:100,width:12},
      {text:'%*',x:930,y:100,width:18}
    ]);
    const source:Observation[]=[header];
    const addRow=(key:string,label:string,y:number,left:string,right:string,unit:string)=>{
      source.push(line(`${key}-label`,label,[{text:label,x:70,y,width:Math.max(70,label.length*8)}]));
      if(unit)source.push(line(`${key}-unit`,unit,[{text:unit,x:520,y,width:18}]));
      source.push(line(`${key}-left`,left,[{text:left,x:600,y,width:42}]));
      source.push(line(`${key}-right`,right,[{text:right,x:810,y,width:42}]));
    };
    source.push(line('energy-label','Énergie',[{text:'Énergie',x:70,y:300,width:72}]));
    source.push(line('energy-kj-unit','kJ',[{text:'kJ',x:520,y:300,width:20}]));
    source.push(line('energy-kj-left','2252',[{text:'2252',x:600,y:300,width:38}]));
    source.push(line('energy-kj-right','336',[{text:'336',x:810,y:300,width:28}]));
    source.push(line('energy-kcal-unit','kcal',[{text:'kcal',x:520,y:324,width:36}]));
    source.push(line('energy-kcal-left','539',[{text:'539',x:600,y:324,width:28}]));
    source.push(line('energy-kcal-right','80',[{text:'80',x:810,y:324,width:20}]));
    addRow('fat','Matières grasses',400,'30.9','4.6','g');
    addRow('sat-fat','dont acides gras saturés',500,'10.6','1.6','g');
    addRow('carbohydrate','Glucides',600,'57.5','8.6','g');
    addRow('sugars','dont sucres',650,'56.3','8.4','g');
    addRow('protein','Protéines',750,'6.3','0.9','g');
    addRow('salt','Sel',850,'0.107','0.016','g');

    const text=source.map(observation=>observation.text).join('\n');
    const result=parseLabel(text,{origin:'ocr',observations:source,ocrCaptures:[capture]});
    const expected=[
      ['fat',30.9,4.6],['saturatedFat',10.6,1.6],['carbohydrate',57.5,8.6],
      ['sugars',56.3,8.4],['protein',6.3,0.9],['salt',0.107,0.016]
    ] as const;
    for(const [key,left,right] of expected){
      expect(result.nutrients).toContainEqual(expect.objectContaining({key,value:left,unit:'g',basis:expect.objectContaining({amount:100,unit:'g'}),status:'observed'}));
      expect(result.nutrients).toContainEqual(expect.objectContaining({key,value:right,unit:'g',basis:expect.objectContaining({amount:15,unit:'g'}),status:'observed'}));
    }
    expect(result.nutrients).toContainEqual(expect.objectContaining({key:'energy',value:2252,unit:'kJ',basis:expect.objectContaining({amount:100,unit:'g'}),status:'observed'}));
    expect(result.nutrients).toContainEqual(expect.objectContaining({key:'energy',value:539,unit:'kcal',basis:expect.objectContaining({amount:100,unit:'g'}),status:'observed'}));
    const proteinCandidate=result.observations.find(observation=>observation.field==='nutrition-row-candidate'&&observation.derivedFromObservationIds?.includes('protein-label'));
    expect(proteinCandidate?.derivedFromObservationIds).toEqual(expect.arrayContaining(['protein-unit','protein-left','protein-right']));
    expect(result.observations.find(observation=>observation.id==='protein-unit')?.text).toBe('g');
    expect(result.rawText).toBe(text);
    expect(result.observations).toEqual(expect.arrayContaining(source.map(observation=>expect.objectContaining({id:observation.id}))));
  });
});
