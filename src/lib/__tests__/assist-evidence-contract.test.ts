import { describe, expect, it } from 'vitest';
import packageInfo from '../../../package.json';
import { assistEvidenceContext, packageForAssist } from '../assist-evidence';
import { BROWSER_OCR_ENGINE_VERSION } from '../browser';
import { calculationEvidenceText, defaultProfile, packageSchema, type PackageData } from '../contracts';
import { retrieveEvidence } from '../knowledge';
import { mergePackageEvidence } from '../merge-evidence';
import { parseLabel } from '../parser';
import { assistInput, validateClaims } from '../server/gemini';

const imageId='photo-private-1';
const runId='ocr-run-1';
const lines=['Nutrition information','Per 100 g','Protein approx 8.8 g','Sodium 850 mg','Sodium 85 mg'];
const observations=lines.map((text,lineIndex)=>({
  id:`line-${lineIndex}`,field:'ocr-line' as const,text,side:'back' as const,confidence:lineIndex===2?51:91,origin:'ocr' as const,imageId,
  bbox:{x0:12,y0:lineIndex*40,x1:230,y1:lineIndex*40+22},...(lineIndex===2?{ocrWords:[{wordIndex:0,text:'Protein',confidence:93,bbox:{x0:12,y0:80,x1:105,y1:102}},{wordIndex:1,text:'approx',confidence:44,bbox:{x0:112,y0:80,x1:166,y1:102}},{wordIndex:2,text:'8.8',confidence:49,bbox:{x0:172,y0:80,x1:200,y1:102}},{wordIndex:3,text:'g',confidence:68,bbox:{x0:205,y0:80,x1:218,y1:102}}]}:{ }),readingOrder:{runId,blockIndex:0,paragraphIndex:0,lineIndex}
}));
const capture={
  runId,imageId,side:'back' as const,sourceImage:{width:1200,height:1800},preparedImage:{width:2000,height:3000},bboxCoordinateSpace:'prepared-image-pixels' as const,
  engine:{name:'tesseract.js' as const,version:'7.0.0',language:'eng',confidenceScale:'0-100' as const,segmentationMode:'single-block' as const},
  processing:{rotation:0 as const,contrast:false,invert:false,cropPercent:null}
};

function makePackage(){
  return parseLabel(lines.join('\n'),{origin:'ocr',observations,ocrCaptures:[capture]});
}

describe('OCR-to-assist evidence contract',()=>{
  it('keeps recorded Tesseract.js version synchronized with the pinned dependency',()=>{
    expect(BROWSER_OCR_ENGINE_VERSION).toBe(packageInfo.dependencies['tesseract.js']);
  });

  it('preserves a bounded alternate reader identifier without implying reader integration',()=>{
    const pkg=makePackage();
    const captureWithAlternateReader={...capture,engine:{...capture.engine,name:'rapidocr'}};
    const alternatePackage=parseLabel(lines.join('\n'),{origin:'ocr',observations,ocrCaptures:[captureWithAlternateReader]});
    const assistData=assistInput.parse({consent:true,question:'What does the noisy row appear to say?',package:alternatePackage});

    expect(assistData.package.ocrCaptures?.[0].engine.name).toBe('rapidocr');
    expect(packageSchema.safeParse({...alternatePackage,ocrCaptures:[{...captureWithAlternateReader,engine:{...captureWithAlternateReader.engine,name:'x'.repeat(81)}}]}).success).toBe(false);
  });

  it('requires raw OCR lines to retain their source image and reading order before assist',()=>{
    const pkg=makePackage();
    const unlinked={...pkg,observations:pkg.observations.map(item=>item.id==='line-0'?{...item,imageId:undefined,readingOrder:undefined}:item)};
    expect(packageSchema.safeParse(unlinked).success).toBe(true);
    expect(assistInput.safeParse({consent:true,question:'What did the label say?',package:unlinked}).success).toBe(false);
    expect(assistInput.safeParse({consent:true,question:'What did the label say?',package:pkg}).success).toBe(true);
  });

  it('matches live browser image handles to OCR capture side and original dimensions',()=>{
    const pkg=makePackage();
    const base={consent:true as const,question:'What did the label say?',package:pkg};
    const matching={handle:imageId,side:'back' as const,width:1200,height:1800};

    expect(assistInput.safeParse({...base,images:[matching]}).success).toBe(true);
    expect(assistInput.safeParse({...base,images:[{...matching,side:'front'}]}).success).toBe(false);
    expect(assistInput.safeParse({...base,images:[{...matching,width:1201}]}).success).toBe(false);
    expect(assistInput.safeParse({...base,images:[{...matching,height:1801}]}).success).toBe(false);
  });

  it('keeps word text, recognition scores, layout and order inside each original OCR line',()=>{
    const pkg=makePackage();
    const rawLine=pkg.observations.find(item=>item.id==='line-2')!;
    expect(rawLine.text).toBe('Protein approx 8.8 g');
    expect(rawLine.ocrWords).toEqual([
      {wordIndex:0,text:'Protein',confidence:93,bbox:{x0:12,y0:80,x1:105,y1:102}},
      {wordIndex:1,text:'approx',confidence:44,bbox:{x0:112,y0:80,x1:166,y1:102}},
      {wordIndex:2,text:'8.8',confidence:49,bbox:{x0:172,y0:80,x1:200,y1:102}},
      {wordIndex:3,text:'g',confidence:68,bbox:{x0:205,y0:80,x1:218,y1:102}}
    ]);
    const assistData=assistInput.parse({consent:true,question:'What did the row appear to say?',package:pkg});
    expect(assistData.package.observations.find(item=>item.id==='line-2')?.ocrWords).toEqual(rawLine.ocrWords);
    expect(packageSchema.safeParse({...pkg,observations:pkg.observations.map(item=>item.id==='line-2'?{...item,ocrWords:[{wordIndex:0,text:'outside',confidence:90,bbox:{x0:12,y0:80,x1:2001,y1:102}}]}:item)}).success).toBe(false);
    expect(packageSchema.safeParse({...pkg,observations:pkg.observations.map(item=>item.id==='line-2'?{...item,ocrWords:[{wordIndex:0,text:'Protein',confidence:90,bbox:{x0:12,y0:80,x1:105,y1:102}},{wordIndex:0,text:'approx',confidence:44,bbox:{x0:112,y0:80,x1:166,y1:102}}]}:item)}).success).toBe(false);
    expect(packageSchema.safeParse({...pkg,observations:pkg.observations.map(item=>item.id==='line-2'?{...item,ocrWords:[{wordIndex:1,text:'Protein',confidence:90,bbox:{x0:12,y0:80,x1:105,y1:102}},{wordIndex:0,text:'approx',confidence:44,bbox:{x0:112,y0:80,x1:166,y1:102}}]}:item)}).success).toBe(false);
  });

  it('accepts text-only or restored scans without requiring live browser image handles',()=>{
    const pkg=parseLabel('Nutrition information\nSugars 4 g',{origin:'user'});
    expect(pkg.ocrCaptures).toBeUndefined();
    expect(assistInput.safeParse({consent:true,question:'What does the label say?',package:pkg}).success).toBe(true);
  });

  it('accepts only bounded optional conversation context and never treats it as citeable evidence',()=>{
    const pkg=makePackage();
    const conversationContext=Array.from({length:4},(_,index)=>({question:`Prior question ${index+1}`,answer:'A previous local reply; unverified context only.'}));
    const base={consent:true as const,question:'Why did you say that?',package:pkg};
    const data=assistInput.parse({...base,conversationContext});
    expect(data.conversationContext).toEqual(conversationContext);
    expect(assistInput.safeParse({...base,conversationContext:[...conversationContext,{question:'too many',answer:''}]}).success).toBe(false);
    expect(assistInput.safeParse({...base,conversationContext:[{question:'   ',answer:'context'}]}).success).toBe(false);
    expect(()=>validateClaims({answer:'ignored',claims:[{mode:'synthesis',text:'A prior answer said this is suitable.',observationIds:['conversation-turn-1'],sourceIds:[],supportingSpans:[{kind:'observation',id:'conversation-turn-1',quote:'A previous local reply'}]}],limitations:[],inspectImage:null},data)).toThrow('unknown evidence');
  });

  it('keeps imperfect raw lines, reading order, prepared-image geometry, capture provenance, and parse rejections/conflicts',()=>{
    const pkg=makePackage();
    expect(pkg.rawText).toBe(lines.join('\n'));
    expect(pkg.observations.filter(item=>item.field==='ocr-line').map(item=>item.text)).toEqual(lines);
    expect(pkg.observations.find(item=>item.id==='line-2')).toMatchObject({confidence:51,imageId,readingOrder:{runId,lineIndex:2},bbox:{x0:12,y0:80},ocrWords:[{wordIndex:0,text:'Protein'},{wordIndex:1,text:'approx'},{wordIndex:2,text:'8.8'},{wordIndex:3,text:'g'}]});
    expect(pkg.ocrCaptures).toEqual([capture]);
    const protein=pkg.parserDiagnostics?.find(item=>item.field==='protein');
    expect(protein).toMatchObject({decision:'rejected',reasonCodes:['approximate-or-bounded'],numericCandidates:[{rawValueText:'8.8',value:8.8,unit:'g'}]});
    expect(protein?.numericEvidenceObservationIds).toEqual(['line-2']);
    expect(protein?.basisEvidenceObservationIds).toEqual(['line-1']);
    const sodium=pkg.parserDiagnostics?.filter(item=>item.field==='sodium');
    expect(sodium).toHaveLength(2);
    expect(sodium?.every(item=>item.decision==='conflict'&&item.reasonCodes.includes('cross-reading-conflict'))).toBe(true);
    expect(sodium?.map(item=>item.numericEvidenceObservationIds)).toEqual([['line-3'],['line-4']]);
    expect(sodium?.every(item=>item.basisEvidenceObservationIds?.includes('line-1'))).toBe(true);
    const structuredProtein=pkg.observations.find(item=>item.field==='protein');
    expect(structuredProtein?.derivedFromObservationIds).toEqual(['line-2']);
    expect(pkg.nutrients.some(item=>item.key==='protein')).toBe(false);
    expect(pkg.nutrients.filter(item=>item.key==='sodium').every(item=>item.status==='conflict')).toBe(true);
  });

  it('removes only fully duplicated OCR text from assist payloads and preserves mixed or unmatched text',()=>{
    const pkg=makePackage();
    const compact=packageForAssist(pkg);
    expect(compact.rawText).toBe('');
    expect(compact.observations.filter(item=>item.field==='ocr-line')).toEqual(pkg.observations.filter(item=>item.field==='ocr-line'));
    expect(compact.parserDiagnostics).toEqual(pkg.parserDiagnostics);
    expect(pkg.rawText).toBe(lines.join('\n'));

    const mixed={...pkg,rawText:`${pkg.rawText}\nUnparsed user note`};
    expect(packageForAssist(mixed)).toBe(mixed);
    const missingLine={...pkg,observations:pkg.observations.filter(item=>item.id!=='line-4')};
    expect(packageForAssist(missingLine)).toBe(missingLine);
  });

  it('keeps a bounded ten-photo OCR request intact after duplicate-text compaction',()=>{
    const sampleLines=[
      'Nutrition information per 100 g average pack','Energy 1937 kJ and 463 kcal printed','Carbohydrate 67 g per hundred grams','Total sugars 6 g per 100 g typical','Added sugars 0 g per 100 g typical','Protein 8.8 g per 100 g typical','Total fat 17 g per 100 g typical','Saturated fat 3.4 g per 100 g typical','Trans fat 0 g per 100 g typical','Dietary fibre 6 g per 100 g typical','Sodium 850 mg per 100 g typical','Salt equivalent 2.1 g per 100 g','Serving size 30 g approximately stated','Ingredients: oats sugar palm oil salt','May contain milk soy peanuts sesame','Made by Example Foods Private Limited India'
    ];
    const readPhoto=(photoIndex:number):PackageData=>{
      const imageId=`photo-${photoIndex}`,photoRunId=`ocr-run-${photoIndex}`;
      const photoObservations=sampleLines.map((text,lineIndex)=>({
        id:`${imageId}-line-${lineIndex}`,field:'ocr-line' as const,text,side:'back' as const,confidence:78,origin:'ocr' as const,imageId,
        bbox:{x0:12,y0:lineIndex*40,x1:900,y1:lineIndex*40+24},
        ocrWords:text.split(/\s+/).map((word,wordIndex)=>({wordIndex,text:word,confidence:70+(wordIndex%25),bbox:{x0:12+wordIndex*42,y0:lineIndex*40,x1:45+wordIndex*42,y1:lineIndex*40+22}})),
        readingOrder:{runId:photoRunId,blockIndex:0,paragraphIndex:0,lineIndex}
      }));
      const photoCapture={runId:photoRunId,imageId,side:'back' as const,sourceImage:{width:1200,height:1800},preparedImage:{width:2000,height:3000},bboxCoordinateSpace:'prepared-image-pixels' as const,
        engine:{name:'tesseract.js',version:'7.0.0',language:'eng',confidenceScale:'0-100' as const,segmentationMode:'single-block' as const},processing:{rotation:0 as const,contrast:false,invert:false,cropPercent:null}};
      return parseLabel(sampleLines.join('\n'),{origin:'ocr',observations:photoObservations,ocrCaptures:[photoCapture]});
    };

    let pkg=readPhoto(0);
    for(let photoIndex=1;photoIndex<10;photoIndex++)pkg=mergePackageEvidence(pkg,readPhoto(photoIndex));
    const compact=packageForAssist(pkg);
    const body={consent:true as const,question:'What can you read from all of these package photos?',package:compact,images:Array.from({length:10},(_,index)=>({handle:`photo-${index}`,side:'back' as const,width:1200,height:1800}))};
    const bytes=new TextEncoder().encode(JSON.stringify(body)).byteLength;
    const duplicatedBytes=new TextEncoder().encode(JSON.stringify({...body,package:pkg})).byteLength;
    const parsed=assistInput.safeParse(body);

    expect(parsed.success).toBe(true);
    expect(compact.rawText).toBe('');
    expect(compact.observations.filter(item=>item.field==='ocr-line')).toHaveLength(160);
    expect(compact.observations.filter(item=>item.field==='ocr-line').reduce((sum,item)=>sum+(item.ocrWords?.length??0),0)).toBe(sampleLines.reduce((sum,line)=>sum+line.split(/\s+/).length,0)*10);
    expect(compact.ocrCaptures).toHaveLength(10);
    expect(compact.parserDiagnostics?.length).toBeGreaterThan(0);
    expect(duplicatedBytes).toBeGreaterThan(250_000);
    expect(bytes).toBeLessThan(duplicatedBytes);
    expect(bytes).toBeLessThanOrEqual(300_000);
    expect(bytes).toBeGreaterThan(100_000);
  });

  it('allows a cited paraphrase and tentative candidate without promoting either into package facts',()=>{
    const pkg=makePackage();
    const data=assistInput.parse({consent:true,question:'What does the noisy protein row appear to say?',package:pkg,images:[{handle:imageId,side:'back',width:1200,height:1800,role:'nutrition',description:'private in-session note'}]});
    expect(data.package.rawText).toBe(pkg.rawText);
    expect(data.package.ocrCaptures).toEqual(pkg.ocrCaptures);
    expect(data.package.parserDiagnostics).toEqual(pkg.parserDiagnostics);
    expect(data.package.observations.find(item=>item.id==='line-2')).toMatchObject({origin:'ocr',imageId,readingOrder:{runId,lineIndex:2},bbox:{x0:12,y0:80},confidence:51,ocrWords:[{wordIndex:0,text:'Protein'},{wordIndex:1,text:'approx'},{wordIndex:2,text:'8.8'},{wordIndex:3,text:'g'}]});
    expect(data.images?.[0].handle).toBe(data.package.ocrCaptures?.[0].imageId);
    const span={kind:'observation' as const,id:'line-2',quote:'Protein approx 8.8 g'};
    const candidate={candidateId:'candidate-protein-1',kind:'nutrient' as const,field:'protein',proposedValue:'8.8',numericValue:8.8,unit:'g',basis:null,normalizedEntity:'protein',status:'tentative' as const,observationIds:['line-2'],sourceIds:[],supportingSpans:[span],ocrWordEvidence:[{observationId:'line-2',role:'label' as const,wordIndexes:[0]},{observationId:'line-2',role:'value' as const,wordIndexes:[2]},{observationId:'line-2',role:'unit' as const,wordIndexes:[3]}],uncertainty:'The printed row is approximate and no basis is tied to this candidate.'};
    const output={
      answer:'ignored free-form answer',
      claims:[{mode:'synthesis',text:'The protein row appears to contain an approximate 8.8 g reading, but its serving basis is not established.',observationIds:['line-2'],sourceIds:[],supportingSpans:[span]}],
      tentativeCandidates:[candidate],
      limitations:[],inspectImage:null
    };
    const result=validateClaims(output,data);
    expect(result.answer).toContain('AI-generated paraphrase');
    expect(result.answer).toContain('The protein row appears to contain');
    expect(result.answer).toContain('Protein approx 8.8 g');
    expect(result.tentativeCandidates).toHaveLength(1);
    expect(result.tentativeCandidates[0]).toMatchObject({status:'tentative',numericValue:8.8,basis:null,observationIds:['line-2'],ocrWordEvidence:candidate.ocrWordEvidence});
    expect(data.package.nutrients.some(item=>item.key==='protein')).toBe(false);
    expect(validateClaims({...output,tentativeCandidates:[{...candidate,ocrWordEvidence:[]}]},data).tentativeCandidates).toEqual([]);
    expect(validateClaims({...output,tentativeCandidates:[{...candidate,ocrWordEvidence:[{observationId:'line-2',role:'value',wordIndexes:[99]}]}]},data).tentativeCandidates).toEqual([]);
    expect(validateClaims({...output,tentativeCandidates:[{...candidate,ocrWordEvidence:[{observationId:'line-1',role:'value',wordIndexes:[0]}]}]},data).tentativeCandidates).toEqual([]);
  });

  it('keeps a noisy OCR entity normalization tentative while linking both retrieved knowledge and original words',()=>{
    const noisyLine={
      id:'line-additive',field:'ocr-line' as const,text:'Calciurn disodium edetate',side:'back' as const,confidence:58,origin:'ocr' as const,imageId,
      bbox:{x0:12,y0:240,x1:258,y1:262},
      ocrWords:[
        {wordIndex:0,text:'Calciurn',confidence:54,bbox:{x0:12,y0:240,x1:105,y1:262}},
        {wordIndex:1,text:'disodium',confidence:83,bbox:{x0:112,y0:240,x1:182,y1:262}},
        {wordIndex:2,text:'edetate',confidence:91,bbox:{x0:189,y0:240,x1:258,y1:262}}
      ],
      readingOrder:{runId,blockIndex:0,paragraphIndex:0,lineIndex:5}
    };
    const rawText=[...lines,noisyLine.text].join('\n');
    const pkg=parseLabel(rawText,{origin:'ocr',observations:[...observations,noisyLine],ocrCaptures:[capture]});
    const hit=retrieveEvidence('INS 385',4).find(item=>item.source.id==='fao-385');
    expect(hit).toBeDefined();
    const evidence=assistEvidenceContext({auditSources:[],localSearch:hit?[{...hit.source,score:hit.score}]:[],research:[]});
    const data=assistInput.parse({consent:true,question:'Could this noisy ingredient line be calcium disodium EDTA?',package:pkg,evidence});
    const source=data.evidence?.find(item=>item.id==='fao-385')!;
    const sourceSpan='The FAO JECFA entry identifies Calcium Disodium Ethylenediaminetetraacetate and lists calcium disodium edetate and calcium disodium EDTA as synonyms; it links Codex GSFA INS number 385.';
    const candidate={
      candidateId:'candidate-additive-1',kind:'additive' as const,field:'additive',proposedValue:'Calcium Disodium EDTA (INS 385)',numericValue:null,unit:null,basis:null,
      normalizedEntity:'Calcium Disodium EDTA',status:'tentative' as const,observationIds:[noisyLine.id],sourceIds:[source.id],
      supportingSpans:[{kind:'observation' as const,id:noisyLine.id,quote:noisyLine.text},{kind:'source' as const,id:source.id,quote:sourceSpan}],
      ocrWordEvidence:[{observationId:noisyLine.id,role:'identity' as const,wordIndexes:[0,1,2]}],
      uncertainty:'The OCR spelling is uncertain. This source supports an entity-name match, not a confirmed package ingredient or amount.'
    };
    const result=validateClaims({answer:'ignored',claims:[],tentativeCandidates:[candidate],limitations:[],inspectImage:null},data);

    expect(source.summary).toContain(sourceSpan);
    expect(data.package.observations.find(item=>item.id===noisyLine.id)?.ocrWords).toEqual(noisyLine.ocrWords);
    expect(pkg.additives).not.toContain('385');
    expect(result.tentativeCandidates).toEqual([candidate]);
    expect(result.answer).toContain('Not verified and not added to package facts.');
  });

  it('supports careful profile-aware paraphrases with exact user-context and OCR spans',()=>{
    const pkg=makePackage();
    const profile={...defaultProfile,goals:'compare quick breakfast options'};
    const data=assistInput.parse({consent:true,question:'Does this help with my comparison?',package:pkg,profile});
    const output={answer:'ignored',claims:[{
      mode:'synthesis',text:'You said you are comparing quick breakfast options. The label contains conflicting sodium readings of 850 mg and 85 mg, so this package does not yet support a reliable comparison.',
      observationIds:['line-3','line-4'],sourceIds:[],profileFieldIds:['goals'],
      supportingSpans:[
        {kind:'profile',id:'goals',quote:'compare quick breakfast options'},
        {kind:'observation',id:'line-3',quote:'Sodium 850 mg'},
        {kind:'observation',id:'line-4',quote:'Sodium 85 mg'}
      ]
    }],limitations:[],inspectImage:null};
    const result=validateClaims(output,data);
    expect(result.claims).toHaveLength(1);
    expect(result.answer).toContain('Evidence-linked interpretation');
    expect(result.answer).toContain('[profile:goals]');
    expect(result.answer).toContain('Sodium 850 mg');
    expect(result.answer).toContain('Sodium 85 mg');

    const unsupportedProfileQuote=validateClaims({...output,claims:[{...output.claims[0],supportingSpans:[...output.claims[0].supportingSpans.slice(1),{kind:'profile' as const,id:'goals',quote:'I have diabetes'}]}]},data);
    expect(unsupportedProfileQuote.claims).toEqual([]);
    const profileCannotValidateSafety=validateClaims({...output,claims:[{...output.claims[0],text:'This product is safe.',supportingSpans:output.claims[0].supportingSpans}]},data);
    expect(profileCannotValidateSafety.claims).toEqual([]);
    const withoutProfile=assistInput.parse({consent:true,question:'What do I want?',package:pkg});
    expect(()=>validateClaims(output,withoutProfile)).toThrow('unknown evidence');
    expect(data.package.nutrients.some(item=>item.key==='sodium'&&item.status==='observed')).toBe(false);
  });

  it('accepts a bounded paraphrase that combines an OCR observation with locally retrieved food guidance',()=>{
    const pkg=parseLabel('Nutrition information\nPer 100 g\nSugars 12 g',{origin:'user'});
    const source=retrieveEvidence('What does WHO say about free sugars, and does this package row establish daily intake?',4).find(hit=>hit.source.id==='who-sugars-2015')?.source;
    expect(source).toBeDefined();
    const data=assistInput.parse({consent:true,question:'Does this label tell me my daily free-sugar intake?',package:pkg,evidence:source?[source]:[]});
    const sugar=pkg.observations.find(item=>item.field==='sugars')!;
    const who=data.evidence?.find(item=>item.id==='who-sugars-2015')!;
    const output={answer:'ignored',claims:[{
      mode:'synthesis' as const,
      text:'The package line reports 12 g of sugars per 100 g. WHO guidance concerns free sugars across the whole diet, so this line alone does not establish daily free-sugar intake.',
      observationIds:[sugar.id],sourceIds:[who.id],
      supportingSpans:[{kind:'observation' as const,id:sugar.id,quote:'Sugars 12 g'},{kind:'source' as const,id:who.id,quote:'free sugars to less than 10% of total daily energy'}]
    }],limitations:[],inspectImage:null};
    const result=validateClaims(output,data);
    expect(result.claims).toHaveLength(1);
    expect(result.answer).toContain('Evidence-linked interpretation');
    expect(result.answer).toContain('whole diet');
    expect(result.answer).toContain('[source:who-sugars-2015]');
  });

  it('makes user-requested research results available as cited candidate evidence',()=>{
    const pkg=parseLabel('Nutrition per 100 g\nSugars 12 g',{origin:'user'});
    const evidence=assistEvidenceContext({auditSources:[],localSearch:[],research:[{
      id:'epmc-example-trial',title:'Example food study',url:'https://europepmc.org/article/MED/12345',publisher:'Example Journal',
      publishedAt:'2024-01-02',effectiveAt:null,retrievedAt:'2026-10-21T12:00:00.000Z',category:'Randomized Controlled Trial',
      summary:'Abstract: participants consumed the test food for four weeks.',limitations:'Search match only; study quality and applicability have not been assessed.'
    }]});
    const data=assistInput.parse({consent:true,question:'What does this research result say about the product?',package:pkg,evidence});
    const result=validateClaims({answer:'ignored',claims:[{
      mode:'synthesis',text:'This is a research-search candidate; its abstract describes a four-week study, while the search result says applicability has not been assessed.',
      observationIds:[],sourceIds:['epmc-example-trial'],supportingSpans:[
        {kind:'source',id:'epmc-example-trial',quote:'Search classification: Randomized Controlled Trial'},
        {kind:'source',id:'epmc-example-trial',quote:'Abstract: participants consumed the test food for four weeks.'},
        {kind:'source',id:'epmc-example-trial',quote:'Search match only; study quality and applicability have not been assessed.'}
      ]
    }],limitations:[],inspectImage:null},data);
    expect(result.claims).toHaveLength(1);
    expect(result.answer).toContain('applicability has not been assessed');
    expect(data.evidence?.[0].category).toBe('literature');
  });

  it('accepts only supplied deterministic calculations as calculation evidence',()=>{
    const pkg=parseLabel('Nutrition per 100 g\nProtein 8.8 g',{origin:'user'});
    const baseCalculation={id:'calc-protein-30g',label:'Protein in 30 g',nutrient:'protein' as const,input:8.8,inputUnit:'g',basisAmount:100,portion:30,portionUnit:'g' as const,result:2.64,unit:'g',formula:'8.8 g × 30 g ÷ 100 g',observationIds:[pkg.observations.find(item=>item.field==='protein')!.id],assumptions:['The label reading is correct.']};
    const calculation={...baseCalculation,evidenceText:calculationEvidenceText(baseCalculation)};
    const data=assistInput.parse({consent:true,question:'How much protein is in 30 g?',package:pkg,calculations:[calculation]});
    const quote=calculation.evidenceText;
    const result=validateClaims({answer:'ignored',claims:[{mode:'direct-quote',text:quote,observationIds:[],sourceIds:[],calculationIds:[calculation.id],supportingSpans:[{kind:'calculation',id:calculation.id,quote}]}],limitations:[],inspectImage:null},data);
    expect(result.answer).toContain(`Validated calculation: “${quote}”`);
    expect(assistInput.safeParse({consent:true,question:'How much protein?',package:pkg,calculations:[{...calculation,observationIds:['missing-observation']}]}).success).toBe(false);
    expect(assistInput.safeParse({consent:true,question:'How much protein?',package:pkg,calculations:[{...calculation,evidenceText:'forged calculation text'}]}).success).toBe(false);
  });

  it('rejects paraphrases without exact evidence spans and unsupported health-safety conclusions',()=>{
    const pkg=makePackage();
    const data=assistInput.parse({consent:true,question:'Is this safe?',package:pkg});
    const validSpan={kind:'observation' as const,id:'line-3',quote:'Sodium 850 mg'};
    const base={answer:'ignored',claims:[],limitations:[],inspectImage:null};
    const unsupported=validateClaims({...base,claims:[{mode:'synthesis',text:'This product is safe for diabetes.',observationIds:['line-3'],sourceIds:[],supportingSpans:[validSpan]}]},data);
    expect(unsupported.claims).toEqual([]);
    expect(unsupported.answer).toContain('No supported factual conclusion');
    const forged=validateClaims({...base,claims:[{mode:'synthesis',text:'Sodium is low.',observationIds:['line-3'],sourceIds:[],supportingSpans:[{...validSpan,quote:'Sodium is low'}]}]},data);
    expect(forged.claims).toEqual([]);
    expect(forged.answer).not.toContain('Sodium is low.');
  });
});
