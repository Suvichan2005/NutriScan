import { describe, expect, it } from 'vitest';
import packageInfo from '../../../package.json';
import { BROWSER_OCR_ENGINE_VERSION } from '../browser';
import { calculationEvidenceText, defaultProfile, packageSchema } from '../contracts';
import { retrieveEvidence } from '../knowledge';
import { parseLabel } from '../parser';
import { assistInput, validateClaims } from '../server/gemini';

const imageId='photo-private-1';
const runId='ocr-run-1';
const lines=['Nutrition information','Per 100 g','Protein approx 8.8 g','Sodium 850 mg','Sodium 85 mg'];
const observations=lines.map((text,lineIndex)=>({
  id:`line-${lineIndex}`,field:'ocr-line' as const,text,side:'back' as const,confidence:lineIndex===2?51:91,origin:'ocr' as const,imageId,
  bbox:{x0:12,y0:lineIndex*40,x1:230,y1:lineIndex*40+22},readingOrder:{runId,blockIndex:0,paragraphIndex:0,lineIndex}
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
    expect(pkg.observations.find(item=>item.id==='line-2')).toMatchObject({confidence:51,imageId,readingOrder:{runId,lineIndex:2},bbox:{x0:12,y0:80}});
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

  it('allows a cited paraphrase and tentative candidate without promoting either into package facts',()=>{
    const pkg=makePackage();
    const data=assistInput.parse({consent:true,question:'What does the noisy protein row appear to say?',package:pkg,images:[{handle:imageId,side:'back',width:1200,height:1800,role:'nutrition',description:'private in-session note'}]});
    expect(data.package.rawText).toBe(pkg.rawText);
    expect(data.package.ocrCaptures).toEqual(pkg.ocrCaptures);
    expect(data.package.parserDiagnostics).toEqual(pkg.parserDiagnostics);
    expect(data.package.observations.find(item=>item.id==='line-2')).toMatchObject({origin:'ocr',imageId,readingOrder:{runId,lineIndex:2},bbox:{x0:12,y0:80},confidence:51});
    expect(data.images?.[0].handle).toBe(data.package.ocrCaptures?.[0].imageId);
    const span={kind:'observation' as const,id:'line-2',quote:'Protein approx 8.8 g'};
    const result=validateClaims({
      answer:'ignored free-form answer',
      claims:[{mode:'synthesis',text:'The protein row appears to contain an approximate 8.8 g reading, but its serving basis is not established.',observationIds:['line-2'],sourceIds:[],supportingSpans:[span]}],
      tentativeCandidates:[{candidateId:'candidate-protein-1',kind:'nutrient',field:'protein',proposedValue:'8.8',numericValue:8.8,unit:'g',basis:null,normalizedEntity:'protein',status:'tentative',observationIds:['line-2'],sourceIds:[],supportingSpans:[span],uncertainty:'The printed row is approximate and no basis is tied to this candidate.'}],
      limitations:[],inspectImage:null
    },data);
    expect(result.answer).toContain('AI-generated paraphrase');
    expect(result.answer).toContain('The protein row appears to contain');
    expect(result.answer).toContain('Protein approx 8.8 g');
    expect(result.tentativeCandidates).toHaveLength(1);
    expect(result.tentativeCandidates[0]).toMatchObject({status:'tentative',numericValue:8.8,basis:null,observationIds:['line-2']});
    expect(data.package.nutrients.some(item=>item.key==='protein')).toBe(false);
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
