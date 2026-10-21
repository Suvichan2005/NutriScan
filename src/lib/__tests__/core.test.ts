import { describe, expect, it } from 'vitest';
import { parseLabel } from '../parser';
import { buildAudit } from '../engine';
import { defaultProfile, packageSchema, profileSchema, sourceSchema } from '../contracts';
import { detectAdditives, evidenceSources, lookupAdditive, retrieveEvidence } from '../knowledge';

const label=(body:string)=>parseLabel(`Synthetic test snack\n${body}`,{origin:'fixture',synthetic:true});
const calc=(body:string,portion=30,unit:'g'|'ml'='g')=>buildAudit(label(body),portion,unit,defaultProfile,'How much sugar?');
describe('conservative package extraction',()=>{
  it('keeps optional user product details separate from package-label text',()=>{
    const pkg=parseLabel('Nutrition per 100 g\nProtein 12 g',{origin:'ocr',userDescription:'Bought at a local market; package says wholegrain.'});
    expect(pkg.rawText).not.toContain('local market');
    expect(pkg.userDescription).toContain('local market');
    const audit=buildAudit(pkg,100,'g',defaultProfile,'What is known about this package?');
    const context=audit.findings.find(f=>f.title==='User-provided product details');
    expect(context?.status).toBe('context');
    expect(context?.observationIds).toEqual([pkg.observations.find(o=>o.field==='user-description')?.id]);
    expect(context?.detail).toMatch(/not been verified/i);
  });
  it('does not promote OCR codes outside the ingredient section into additive findings',()=>{
    const noisy=parseLabel('Coca-Cola\nNutrition information per 100 ml\nSugars 10.6 g\nhy E000\nProtein 0 g',{origin:'ocr'});
    expect(noisy.additives).toEqual([]);
    expect(noisy.observations.some(observation=>observation.field==='additive:000')).toBe(false);
    const declared=parseLabel('Coca-Cola\nIngredients: Carbonated water, colour (INS 955)\nNutrition information per 100 ml\nSugars 10.6 g',{origin:'ocr'});
    expect(declared.additives).toEqual(['955']);
  });
  it('withholds a low-confidence OCR line from the package title without dropping its observation',()=>{
    const noisyLine='NMUIRNMIVITAL BIv a TARPPIVAIC LC VALUE)S) |';
    const pkg=parseLabel(`${noisyLine}\nPer 100 g\nSaturated fat 3.4 g`,{origin:'ocr',observations:[{id:'low-name',field:'ocr-line',text:noisyLine,side:'back',origin:'ocr',confidence:22,imageId:'photo-1'}]});
    expect(pkg.name).toBe('Unidentified package');
    expect(pkg.rawText).toContain(noisyLine);
    expect(pkg.observations.find(observation=>observation.id==='low-name')?.text).toBe(noisyLine);
    expect(pkg.observations.some(observation=>observation.field==='name'&&observation.text===noisyLine)).toBe(false);
    expect(pkg.warnings.join(' ')).toMatch(/Product name was not established/);
  });
  it('allows a higher-confidence OCR name line while preserving its OCR provenance',()=>{
    const name='NutriScan oats';
    const pkg=parseLabel(`${name}\nPer 100 g\nProtein 8.8 g`,{origin:'ocr',observations:[{id:'clear-name',field:'ocr-line',text:name,side:'back',origin:'ocr',confidence:82,imageId:'photo-1'}]});
    expect(pkg.name).toBe(name);
    expect(pkg.observations.find(observation=>observation.field==='name')).toMatchObject({text:name,origin:'ocr',confidence:82,imageId:'photo-1'});
    expect(pkg.warnings.join(' ')).not.toMatch(/Product name was not established/);
  });
  it('withholds an otherwise plausible OCR name below the conservative 80% display threshold',()=>{
    const name='Heinz Baked Beans';
    const pkg=parseLabel(`${name}\nPer 100 g\nProtein 4.8 g`,{origin:'ocr',observations:[{id:'moderate-name',field:'ocr-line',text:name,side:'front',origin:'ocr',confidence:79}]});
    expect(pkg.name).toBe('Unidentified package');
    expect(pkg.observations.find(observation=>observation.id==='moderate-name')?.text).toBe(name);
    expect(pkg.observations.some(observation=>observation.field==='name')).toBe(false);
  });
  it('does not promote a high-confidence serving declaration to the package title',()=>{
    const servingLine='No. of Servings per pack: 4, Serving measure: 38 g (1/2 cup)';
    const pkg=parseLabel(`${servingLine}\nNutrition Information\nPer 100 g\nProtein 8.8 g`,{origin:'ocr',observations:[{id:'serving-line',field:'ocr-line',text:servingLine,side:'back',origin:'ocr',confidence:88}]});
    expect(pkg.name).toBe('Unidentified package');
    expect(pkg.observations.some(observation=>observation.field==='name'&&observation.text===servingLine)).toBe(false);
    expect(pkg.warnings.join(' ')).toMatch(/Product name was not established/);
  });
  it('does not promote a high-confidence nutrient sub-row to the package title',()=>{
    const nutrientLine='Soluble Dietary Fibre (g) 5.0 |';
    const pkg=parseLabel(`${nutrientLine}\nPer 100 g\nProtein 8.8 g`,{origin:'ocr',observations:[{id:'nutrient-line',field:'ocr-line',text:nutrientLine,side:'back',origin:'ocr',confidence:71}]});
    expect(pkg.name).toBe('Unidentified package');
    expect(pkg.observations.some(observation=>observation.field==='name'&&observation.text===nutrientLine)).toBe(false);
    expect(pkg.warnings.join(' ')).toMatch(/Product name was not established/);
  });
  it('does not promote an OCR-misspelled nutrient row to the package title',()=>{
    const nutrientLine='Cholesterol (me 0';
    const pkg=parseLabel(`${nutrientLine}\nPer 100 g\nProtein 8.8 g`,{origin:'ocr',observations:[{id:'misspelled-row',field:'ocr-line',text:nutrientLine,side:'back',origin:'ocr',confidence:65}]});
    expect(pkg.name).toBe('Unidentified package');
    expect(pkg.observations.some(observation=>observation.field==='name'&&observation.text===nutrientLine)).toBe(false);
  });
  it('does not promote a high-confidence nutrition reference statement or slogan to the package title',()=>{
    const reference='Apport de référence pour un adulte-type';
    const slogan='® TASTE';
    const pkg=parseLabel(`${slogan}\n${reference}\nPer 100 ml\nSugars 10.6 g`,{origin:'ocr',observations:[
      {id:'slogan',field:'ocr-line',text:slogan,side:'back',origin:'ocr',confidence:70},
      {id:'reference',field:'ocr-line',text:reference,side:'back',origin:'ocr',confidence:83},
    ]});
    expect(pkg.name).toBe('Unidentified package');
    expect(pkg.observations.some(observation=>observation.field==='name')).toBe(false);
    expect(pkg.rawText).toContain(reference);
    expect(pkg.warnings.join(' ')).toMatch(/Product name was not established/);
  });
  it('does not promote a noisy nutrient row with a leading OCR fragment to the package title',()=>{
    const nutrientLine='EF Soluble Dietary Fibre 4.49 1.50';
    const pkg=parseLabel(`${nutrientLine}\nPer 100 g\nProtein 8.8 g`,{origin:'ocr',observations:[{id:'noisy-nutrient',field:'ocr-line',text:nutrientLine,side:'back',origin:'ocr',confidence:71}]});
    expect(pkg.name).toBe('Unidentified package');
    expect(pkg.observations.some(observation=>observation.field==='name')).toBe(false);
    expect(pkg.rawText).toContain(nutrientLine);
  });
  it('withholds partial OCR fragments from nutrition headings and nutrient rows',()=>{
    for (const line of ['$klng Soft Drink with NUTRITION INFORMATION TYPICAL VALUE |','iy | t','Trans Fatly Acids 0g 09']) {
      const pkg=parseLabel(`${line}\nPer 100 g\nProtein 8.8 g`,{origin:'ocr',observations:[{id:`line-${line.length}`,field:'ocr-line',text:line,side:'back',origin:'ocr',confidence:90}]});
      expect(pkg.name).toBe('Unidentified package');
      expect(pkg.observations.some(observation=>observation.field==='name'&&observation.text===line)).toBe(false);
    }
  });
  it('does not promote marketing copy on a package front to product identity',()=>{
    const marketingLine='Baked Beans in a deliciously rich tomato sauce';
    const pkg=parseLabel(`${marketingLine}\nNutrition information per 100 g\nProtein 4.8 g`,{origin:'ocr',observations:[{id:'marketing-copy',field:'ocr-line',text:marketingLine,side:'front',origin:'ocr',confidence:69}]});
    expect(pkg.name).toBe('Unidentified package');
    expect(pkg.rawText).toContain(marketingLine);
    expect(pkg.observations.find(observation=>observation.id==='marketing-copy')?.text).toBe(marketingLine);
    expect(pkg.observations.some(observation=>observation.field==='name')).toBe(false);
  });
  it('preserves explicit zero and leaves missing fields unknown',()=>{
    const pkg=label('Nutrition per 100 g\nSugars 0 g\nSodium 500 mg');
    expect(pkg.nutrients.find(n=>n.key==='sugars')?.value).toBe(0);
    expect(pkg.nutrients.find(n=>n.key==='protein')).toBeUndefined();
    expect(pkg.nutrients.every(n=>n.observationIds.every(id=>pkg.observations.some(o=>o.id===id)))).toBe(true);
    expect(pkg.synthetic).toBe(true);expect(packageSchema.safeParse(pkg).success).toBe(true);
  });
  it('never guesses a missing serving mass or a missing unit',()=>{
    const audit=calc('Per serving\nCarbohydrate 20 g\nSodium 200');
    expect(audit.calculations).toHaveLength(0);
    expect(audit.limitations.join(' ')).toMatch(/unit missing/);
  });
  it('scales a declared serving without treating it as 100 g',()=>{
    const pkg=label('Serving size: 25 g\nPer serving\nCarbohydrate 10 g');
    const basis=pkg.observations.find(o=>o.field==='basis');
    const nutrient=pkg.nutrients.find(n=>n.key==='carbohydrate');
    expect(nutrient?.observationIds).toContain(basis?.id);
    expect(nutrient?.observationIds).toContain(pkg.observations.find(o=>o.field==='serving')?.id);
    const audit=buildAudit(pkg,50,'g',defaultProfile,'How much carbohydrate?');
    expect(audit.calculations.find(c=>c.nutrient==='carbohydrate')?.result).toBe(20);
    expect(audit.calculations.find(c=>c.nutrient==='carbohydrate')?.observationIds).toContain(basis?.id);
  });
  it('retains multiple columns and withholds ambiguous values',()=>{
    const pkg=label('Nutrition per 100 g | per serving (25 g)\nCarbohydrate 60 g | 15 g');
    expect(pkg.nutrients).toHaveLength(2);
    expect(pkg.nutrients.every(n=>n.status==='conflict'&&n.basis===null)).toBe(true);
    expect(buildAudit(pkg,25,'g',defaultProfile).calculations).toHaveLength(0);
  });
  it('retains duplicate conflicting OCR values without selecting either',()=>{
    const pkg=label('Per 100 g\nSodium 850 mg\nSodium 85 mg');
    expect(pkg.nutrients).toHaveLength(2);expect(pkg.nutrients.every(n=>n.status==='conflict')).toBe(true);
    expect(buildAudit(pkg,30,'g',defaultProfile).calculations).toHaveLength(0);
  });
  it('ignores an explicitly percent column but not a second plain number',()=>{
    expect(calc('Per 100 g\nProtein 12 g 20%').calculations[0]?.result).toBe(3.6);
    expect(calc('Per 100 g\nProtein 12 g 20').calculations).toHaveLength(0);
  });
  it('does not treat a bound or an invalid negative as an exact number',()=>{
    expect(calc('Per 100 g\nSugars < 0.5 g\nProtein -2 g').calculations).toHaveLength(0);
    expect(calc('Per 100 g\nProtein - 2 g').calculations).toHaveLength(0);
    expect(calc('Per 100 g\nSugars .5 g',100).calculations[0].result).toBe(.5);
  });
  it('keeps original side, confidence and bounding box on exact line matches',()=>{
    const pkg=parseLabel('Per 100 g\nSodium 100 mg',{origin:'ocr',observations:[{id:'region-1',field:'raw',text:'Sodium 100 mg',side:'back',origin:'ocr',confidence:55,imageId:'photo-back',bbox:{x0:1,y0:2,x1:3,y1:4}}]});
    const obs=pkg.observations.find(o=>o.field==='sodium');expect(obs?.side).toBe('back');expect(obs?.bbox?.x0).toBe(1);expect(obs?.confidence).toBe(55);expect(obs?.imageId).toBe('photo-back');
  });
  it('recognizes common explicit colon headers and limited French label terms',()=>{
    const pkg=label('Per: 100 ml 330 ml\nOf which saturates 0 g 0 g\nOf which sugars 10.6 g 35 g');
    expect(pkg.nutrients.filter(n=>n.key==='sugars')).toHaveLength(2);
    expect(pkg.nutrients.every(n=>n.status==='conflict')).toBe(true);
    const french=calc('Pour 100 g\nGlucides 57,5 g\ndont sucres 56,3 g\nSel 0,107 g',15);
    expect(french.calculations.find(c=>c.nutrient==='sugars')?.result).toBeCloseTo(8.445);
    expect(french.calculations.find(c=>c.nutrient==='salt')?.result).toBeCloseTo(.01605);
  });
  it('recovers OCR-glued basis and nutrient label boundaries without rewriting observations',()=>{
    const raw='NUTRIEMTSPer 100g\nProtein8.8 g\nDietary Fibre (g)12.4\nTotal Fat (g)9.9';
    const pkg=parseLabel(raw,{origin:'ocr'});
    expect(pkg.nutrients.map(n=>[n.key,n.value,n.basis?.amount,n.basis?.unit])).toEqual([
      ['protein',8.8,100,'g'],['fiber',12.4,100,'g'],['fat',9.9,100,'g'],
    ]);
    expect(pkg.rawText).toBe(raw);
    expect(pkg.observations.find(observation=>observation.field==='basis')?.text).toBe('NUTRIEMTSPer 100g');
    expect(pkg.nutrients.every(n=>n.observationIds.every(id=>pkg.observations.some(observation=>observation.id===id)))).toBe(true);
  });
  it('retains energy header unit pairs without assigning both numbers the first unit',()=>{
    const pkg=label('Per 100 ml\nEnergy (kJ/kcal) 180/42');
    expect(pkg.nutrients.map(n=>n.unit)).toEqual(['kJ','kcal']);
    expect(pkg.nutrients.every(n=>n.status==='conflict')).toBe(true);
  });
  it('rejects unbounded text and invalid confidence',()=>{
    expect(()=>parseLabel('a'.repeat(40001))).toThrow();expect(()=>parseLabel('label',{confidence:101})).toThrow();
  });
});
describe('nutrition numerical invariants',()=>{
  it('scales linearly over a bounded range of portions',()=>{
    for(const portion of [1,12.5,25,100,250]){
      const audit=calc('Per 100 g\nCarbohydrate 64 g\nSodium 800 mg',portion);
      expect(audit.calculations.find(c=>c.nutrient==='carbohydrate')?.result).toBeCloseTo(.64*portion,4);
      expect(audit.calculations.find(c=>c.nutrient==='sodium')?.result).toBeCloseTo(8*portion,4);
    }
  });
  it('normalizes sodium g to mg and derives sodium from salt without double-counting',()=>{
    expect(calc('Per 100 g\nSodium 0.8 g',25).calculations[0]?.result).toBe(200);
    const audit=calc('Per 100 g\nSalt 2 g',25);
    expect(audit.calculations.find(c=>c.nutrient==='sodium')?.result).toBe(200);
    expect(audit.findings.find(f=>f.title.includes('equivalent'))?.sourceIds).toContain('who-sodium');
  });
  it('answers a sodium-only salt-amount question with a sourced approximate equivalent',()=>{
    const pkg=label('Per 100 g\nSodium 500 mg');
    const sodiumObservation=pkg.observations.find(o=>o.field==='sodium')!;
    for(const portion of [15,30,60]){
      const audit=buildAudit(pkg,portion,'g',defaultProfile,'How much salt?');
      const equivalent=audit.calculations.find(c=>c.id==='calc-salt-from-sodium');
      expect(equivalent?.result).toBeCloseTo(portion*5/400,8);
      expect(equivalent).toMatchObject({nutrient:'salt',unit:'g',input:500,inputUnit:'mg',basisAmount:100,portion,portionUnit:'g'});
      expect(equivalent?.observationIds).toContain(sodiumObservation.id);
      expect(equivalent?.observationIds.every(id=>pkg.observations.some(observation=>observation.id===id))).toBe(true);
      expect(equivalent?.formula).toContain('500 mg sodium');
      const finding=audit.findings.find(f=>f.title==='Approximate salt equivalent from declared sodium');
      expect(finding).toMatchObject({sourceIds:['who-sodium'],calculationIds:['calc-sodium','calc-salt-from-sodium']});
      expect(finding?.observationIds).toContain(sodiumObservation.id);
      expect(audit.sources.map(s=>s.id)).toContain('who-sodium');
      expect(audit.answer).toMatch(/approximately .* g salt equivalent.*not a printed salt declaration/i);
    }
    expect(pkg.nutrients.map(n=>n.key)).toEqual(['sodium']);
  });
  it('withholds sodium-derived salt when basis dimensions mismatch and never overrides declared salt',()=>{
    const volumeOnly=label('Per 100 ml\nSodium 500 mg');
    expect(buildAudit(volumeOnly,30,'g',defaultProfile,'How much salt?').calculations).toHaveLength(0);

    const declared=label('Per 100 g\nSalt 2 g\nSodium 800 mg');
    const audit=buildAudit(declared,30,'g',defaultProfile,'How much salt?');
    expect(audit.calculations.find(c=>c.id==='calc-salt-from-sodium')).toBeUndefined();
    expect(audit.calculations.find(c=>c.id==='calc-salt')?.result).toBeCloseTo(.6);
    expect(audit.findings.some(f=>f.title==='Approximate salt equivalent from declared sodium')).toBe(false);
  });
  it('withholds inconsistent salt/sodium and incompatible mass-volume conversions',()=>{
    expect(calc('Per 100 g\nSalt 1 g\nSodium 800 mg').calculations).toHaveLength(0);
    expect(calc('Per 100 ml\nSugars 10 g',30,'g').calculations).toHaveLength(0);
  });
  it('withholds impossible food mass and inverted sugar totals',()=>{
    expect(calc('Per 100 g\nCarbohydrate 120 g').calculations).toHaveLength(0);
    expect(calc('Per 100 g\nCarbohydrate 10 g\nSugars 20 g\nAdded sugars 25 g').calculations).toHaveLength(0);
  });
  it('retains equivalent repeated values with distinct declared bases',()=>{
    const audit=calc('Per 100 g\nCarbohydrate 60 g\nPer 25 g\nCarbohydrate 15 g',50);
    expect(audit.calculations.find(c=>c.nutrient==='carbohydrate')?.result).toBe(30);
  });
  it('rejects zero, nonfinite and excessive portions and invalid profiles',()=>{
    for(const value of [0,-1,Infinity,NaN,10001])expect(()=>calc('Per 100 g\nSugars 2 g',value)).toThrow();
    expect(profileSchema.safeParse({...defaultProfile,chapatis:8}).success).toBe(false);
    const dangling=label('Per 100 g\nSugars 2 g');dangling.nutrients[0].observationIds=['missing-region'];
    expect(()=>buildAudit(dangling,30,'g',defaultProfile)).toThrow(/existing package observations/);
  });
  it('keeps an empty profile empty and rejects old example-specific runtime fields',()=>{
    expect(defaultProfile).toEqual({dietaryPattern:'',allergies:'',intolerances:'',healthConsiderations:'',goals:'',ageGroup:'',sexOrReferenceGroup:'',country:'',locality:''});
    expect(profileSchema.safeParse({...defaultProfile,chapatis:8}).success).toBe(false);
    const audit=buildAudit(label('Per 100 g\nCarbohydrate 60 g'),30,'g',defaultProfile,'Can I eat this daily?');
    expect(audit.findings.some(f=>f.title==='Personal context to consider')).toBe(false);
    expect(audit.answer).not.toMatch(/chapati|diabetes|hypertension/i);
  });
  it('uses only declared general context in relevant follow-ups without changing package arithmetic',()=>{
    const pkg=label('Per 100 g\nCarbohydrate 60 g');
    const profile={...defaultProfile,allergies:'Peanuts',intolerances:'Lactose',goals:'Check the ingredient list'};
    const audit=buildAudit(pkg,20,'g',profile,'Is this suitable for me?');
    expect(audit.answer).toMatch(/considered the context you chose to share/i);
    expect(audit.nextQuestions.join(' ')).toMatch(/ingredient/i);
    expect(audit.nextQuestions).toContain('Which exact allergen should I check against the label and its cross-contact wording?');
    expect(audit.nextQuestions).toContain('Which ingredient or declared amount should I compare with your stated intolerance?');
    expect(audit.calculations.find(c=>c.nutrient==='carbohydrate')?.result).toBe(12);
    expect(pkg.nutrients[0].value).toBe(60);expect(pkg.observations.length).toBeGreaterThan(0);
   });
  it('answers diabetes carbohydrate questions without inventing a daily target',()=>{
    const profile={...defaultProfile,healthConsiderations:'Type 2 diabetes'};
    const missing=buildAudit(label('Per 100 g\nSaturated fat 4 g'),50,'g',profile,'How much carbohydrate should I eat daily with diabetes?');
    expect(missing.answer).toMatch(/does not establish total carbohydrate/i);
    expect(missing.answer).toMatch(/cannot calculate a package amount or a daily target/i);
    expect(missing.answer).toMatch(/health care team/i);
    expect(missing.answer).toMatch(/not everyone with diabetes needs to count carbs/i);
    expect(missing.findings.some(f=>f.sourceIds.includes('niddk-meals'))).toBe(true);
    expect(missing.nextQuestions).toContain('Do you have a carbohydrate amount from your health care team that you want compared with this label?');
    expect(missing.answer).not.toMatch(/\b\d+(?:\.\d+)?\s*g\s*\/\s*day/i);

    const known=buildAudit(label('Per 100 g\nCarbohydrate 60 g'),50,'g',profile,'How many carbs should I eat each day with diabetes?');
    expect(known.answer).toMatch(/30 g total carbohydrate in 50 g/i);
    expect(known.answer).toMatch(/package amount, not a personal daily target/i);
    expect(known.answer).toMatch(/NIDDK provides general education, not an individual allowance/i);
    expect(known.answer).toMatch(/not everyone with diabetes needs to count carbs/i);
    expect(known.answer).not.toMatch(/\b\d+(?:\.\d+)?\s*g\s*\/\s*day/i);
  });
  it('does not attach diabetes education to generic label arithmetic, but retains it for explicit diabetes questions',()=>{
    const pkg=label('Sugar-free example\nNutrition per 100 g\nEnergy 180 kcal\nCarbohydrate 30 g\nSugars 4 g');
    const generic=buildAudit(pkg,30,'g',defaultProfile,'What does this nutrition label report for calories, carbohydrates, and sugars per serving?');
    expect(generic.sources.some(source=>source.id==='niddk-meals')).toBe(false);
    expect(generic.findings.some(finding=>finding.sourceIds.includes('niddk-meals'))).toBe(false);
    expect(generic.answer).toMatch(/carbohydrate|calories|sugars/i);

    const explicit=buildAudit(pkg,30,'g',defaultProfile,'How many carbs should someone with diabetes eat daily?');
    expect(explicit.sources.some(source=>source.id==='niddk-meals')).toBe(true);
    expect(explicit.findings.some(finding=>finding.sourceIds.includes('niddk-meals'))).toBe(true);
    expect(explicit.answer).toMatch(/not everyone with diabetes needs to count carbs/i);
  });
  it('surfaces literal allergy and intolerance mentions as separate unverified label observations',()=>{
    const pkg=label('Ingredients: Milk powder, sugar\nContains: Milk');
    const profile={...defaultProfile,allergies:'milk',intolerances:'lactose'};
    const audit=buildAudit(pkg,100,'g',profile,'Is this suitable for me?');
    const allergy=audit.findings.find(f=>f.title==='Food allergy: literal mention');
    const intolerance=audit.findings.find(f=>f.title==='Food intolerance: not established');
    expect(allergy?.status).toBe('uncertain');
    expect(allergy?.observationIds.length).toBeGreaterThan(0);
    expect(allergy?.detail).toMatch(/not a medical determination|not an individual-safety assessment/i);
    expect(intolerance?.detail).toMatch(/No direct text match/);
    expect(intolerance?.detail).toMatch(/not a safety clearance/);
  });
  it('keeps ORS current legal questions explicitly unresolved',()=>{
    const audit=buildAudit(label('ORS drink\nPer 100 ml\nSugars 10 g'),100,'ml',defaultProfile,'Is this ORS legal in India today?');
    expect(audit.trace.find(t=>t.tool==='check_regulatory_updates')?.status).toMatch(/not performed/);
    expect(audit.limitations.join(' ')).toMatch(/Static corpus entries do not establish current law/);
  });
  it('every finding resolves its calculation, source and observation references',()=>{
    const pkg=label('Sugar-free snack\nPer 100 g\nCarbohydrate 50 g\nSodium 600 mg\nIngredients: flour, sucralose (INS 955)');
    const audit=buildAudit(pkg,30,'g',{...defaultProfile,healthConsiderations:'User-supplied health context'},'Can I eat it daily?');
    for(const finding of audit.findings){
      expect(finding.observationIds.every(id=>pkg.observations.some(o=>o.id===id))).toBe(true);
      expect(finding.sourceIds.every(id=>audit.sources.some(s=>s.id===id))).toBe(true);
      expect(finding.calculationIds.every(id=>audit.calculations.some(c=>c.id===id))).toBe(true);
      expect(finding.observationIds.length+finding.sourceIds.length+finding.calculationIds.length).toBeGreaterThan(0);
    }
  });
  it('answers an empty initial question as an overview and rounds prose only',()=>{
    const pkg=label('Per 100 g\nCarbohydrate 60 g\nSugars 10.6 g');
    const audit=buildAudit(pkg,33,'g',defaultProfile,'');
    expect(audit.answer).toMatch(/^For 33 g:/);expect(audit.answer).not.toMatch(/000000000/);
    expect(audit.calculations.find(c=>c.nutrient==='sugars')?.result).toBe(10.6*33/100);
  });
  it('answers sugar claims and additive questions directly with the decisive limit',()=>{
    const pkg=label('Sugar-free example\nPer 100 g\nCarbohydrate 50 g\nSugars 0 g\nIngredients: flour, INS 955');
    const sugarClaim=buildAudit(pkg,30,'g',defaultProfile,'Does sugar-free mean no carbs?');
    expect(sugarClaim.answer).toMatch(/does not establish zero carbohydrate.*15 g/);
    expect(sugarClaim.findings.some(finding=>finding.sourceIds.includes('niddk-meals'))).toBe(true);
    const additive=buildAudit(pkg,30,'g',defaultProfile,'What is INS 955?');
    expect(additive.answer).toMatch(/INS 955 is Sucralose.*does not establish dose/);
    expect(buildAudit(pkg,30,'g',defaultProfile,'What is ingredient code INS 955?').answer).toMatch(/INS 955 is Sucralose.*does not establish dose/);
    expect(additive.trace.find(t=>t.tool==='local_rule_answer')?.status).toMatch(/no language model/);
  });
  it('keeps quick quantity questions quick despite a medical profile',()=>{
    const audit=buildAudit(label('Per 100 g\nSugars 10 g'),30,'g',{...defaultProfile,healthConsiderations:'User-supplied health context'},'How much sugar?');
    expect(audit.answer).toMatch(/3 g total sugars/);expect(audit.nextQuestions).toHaveLength(0);
    expect(audit.trace.some(t=>t.status.includes('quick path'))).toBe(true);
  });
  it('acknowledges unsupported questions instead of presenting a canned nutrient answer',()=>{
    const audit=buildAudit(label('Per 100 g\nSugars 10 g'),30,'g',defaultProfile,'What will happen in the stock market?');
    // "stock" intentionally routes to the current-product-context limitation.
    expect(audit.answer).toMatch(/has not checked current/);
    const other=buildAudit(label('Per 100 g\nSugars 10 g'),30,'g',defaultProfile,'Why is the sky blue?');
    expect(other.answer).toMatch(/local rule engine/);expect(other.answer).not.toMatch(/3 g/);
  });
  it('answers open-ended package-text follow-ups with literal observation provenance',()=>{
    const pkg=label('Ingredients: Oats, milk powder, salt\nContains: Milk\nHigh protein');
    const cases=[
      {question:'What ingredients are listed?',field:'ingredients',literal:'Ingredients: Oats, milk powder, salt'},
      {question:'What allergen warning is shown?',field:'allergens',literal:'Contains: Milk'},
      {question:'What claims does the package make?',field:'claim',literal:'High protein'},
    ];
    for(const item of cases){
      const audit=buildAudit(pkg,30,'g',defaultProfile,item.question);
      const sourceRows=pkg.observations.filter(observation=>observation.field===item.field);
      const finding=audit.findings.find(entry=>entry.title===`Recorded ${item.field==='claim'?'package claims':item.field==='allergens'?'allergen statement':'ingredient text'}`);
      expect(audit.answer).toContain(item.literal);
      expect(audit.answer).toMatch(/observations, not independently verified product facts/i);
      expect(finding?.observationIds).toEqual(sourceRows.map(observation=>observation.id));
      expect(finding?.sourceIds).toEqual([]);
      expect(finding?.status).toBe('observed');
      expect(audit.trace.find(entry=>entry.tool==='local_rule_answer')?.status).toContain('no language model');
    }
  });
  it('keeps missing label text unknown instead of inferring its absence',()=>{
    const audit=buildAudit(label('Per 100 g\nSugars 10 g'),30,'g',defaultProfile,'What ingredients are listed?');
    expect(audit.answer).toMatch(/No readable ingredient text is recorded.*does not establish that the package has none/i);
    expect(audit.findings.some(entry=>entry.title==='Recorded ingredient text')).toBe(false);
  });
});
describe('genuine local evidence retrieval',()=>{
  it('uses exact additive identities, never substring codes or aliases',()=>{
    expect(lookupAdditive('INS 955')?.name).toBe('Sucralose');expect(lookupAdditive('E-955')?.code).toBe('955');
    expect(lookupAdditive('msg')?.code).toBe('621');expect(lookupAdditive('9550')).toBeUndefined();expect(lookupAdditive('sucralose syrup')).toBeUndefined();
    expect(detectAdditives('Ingredients: flour, sweetener (955), xanthan gum (INS 415), E9550')).toEqual(expect.arrayContaining(['955','415']));
    expect(detectAdditives('Barcode 9550000000000')).toEqual([]);
  });
  it('retrieves named authoritative sources with bounded inspectable scores',()=>{
    expect(retrieveEvidence('high blood pressure salty snack')[0].source.id).toBe('who-sodium');
    expect(retrieveEvidence('INS 955')[0].source.id).toBe('fao-955');
    expect(retrieveEvidence('sweeteners weight control').some(h=>h.source.id==='who-nss')).toBe(true);
    expect(retrieveEvidence('ICMR India dietary guidelines').some(h=>h.source.id==='icmrnin-dgi-2024')).toBe(true);
    const diabetes=retrieveEvidence('Does everyone with diabetes need to count carbs? What other meal planning methods are available?');
    expect(diabetes[0]?.source.id).toBe('niddk-meals');
    expect(diabetes[0]?.source.summary).toMatch(/not everyone with diabetes needs to count carbs/i);
    expect(diabetes[0]?.source.retrievedAt).toBe('2026-10-21');
    const fibre=retrieveEvidence('WHO adult naturally occurring dietary fibre 25 g daily');
    expect(fibre[0]?.source.id).toBe('who-carbohydrate-2023');
    expect(fibre[0]?.source.summary).toMatch(/at least 25 g\/day of naturally occurring dietary fibre/);
    expect(fibre[0]?.source.summary).toMatch(/400 g\/day of vegetables and fruits/);
    expect(fibre[0]?.source.limitations).toMatch(/cannot be directly equated with a packaged-food fibre declaration/);
    expect(fibre[0]?.source.url).toBe('https://www.who.int/publications/i/9789240073593');
    expect(evidenceSources.every(s=>sourceSchema.safeParse(s).success)).toBe(true);
    expect(()=>retrieveEvidence('query',0)).toThrow();
  });
  it('does not apply WHO prevention recommendation as existing-diabetes advice',()=>{
    const audit=buildAudit(label('Ingredients: sucralose (INS 955)\nPer 100 g\nSugars 0 g'),30,'g',{...defaultProfile,healthConsiderations:'User-supplied health context'},'Is sucralose safe?');
    expect(audit.findings.find(f=>f.title==='Sweetener guidance has a defined scope')?.detail).toMatch(/excludes people with existing diabetes/);
    expect(audit.findings.some(f=>/provides no dose/.test(f.detail))).toBe(true);
  });
  it('surfaces only intent-matched local references with their scope and limitations',()=>{
    const pkg=label('Per 100 g\nSodium 500 mg');
    const sodium=buildAudit(pkg,30,'g',defaultProfile,'How does this compare for blood pressure?');
    expect(sodium.findings.some(f=>f.sourceIds.includes('who-sodium'))).toBe(true);
    const regulatory=buildAudit(pkg,30,'g',defaultProfile,'Is this product legal in India today?');
    expect(regulatory.findings.some(f=>f.title.includes('Dietary Guidelines for Indians'))).toBe(false);
    const unrelated=buildAudit(pkg,30,'g',defaultProfile,'What are the health effects of preservatives?');
    expect(unrelated.findings.some(f=>f.title.startsWith('Reference to inspect:'))).toBe(false);
    const metadata=buildAudit(pkg,30,'g',defaultProfile,'What do the ICMR Indian dietary guidelines say?');
    const icmrReference=metadata.findings.find(f=>f.sourceIds.includes('icmrnin-dgi-2024'));
    expect(icmrReference?.title).toMatch(/^Reference to inspect:/);
    expect(icmrReference?.detail).toMatch(/bibliographic metadata only|does not reproduce/i);
    expect(metadata.sources.some(source=>source.id==='icmrnin-dgi-2024')).toBe(true);
  });
  it('withholds a general-adult sodium reference for a declared under-18 age group',()=>{
    const pkg=label('Per 100 g\nSodium 500 mg');
    const audit=buildAudit(pkg,30,'g',{...defaultProfile,ageGroup:'16 years'},'How does this compare for blood pressure?');
    expect(audit.calculations.find(c=>c.nutrient==='sodium')?.result).toBe(150);
    expect(audit.findings.some(f=>f.title==='Put sodium in a whole-day context')).toBe(false);
    expect(audit.findings.find(f=>f.title==='Adult sodium reference not applied')?.detail).toMatch(/under-18 age group/);
    expect(audit.limitations.join(' ')).toMatch(/no pediatric sodium target was inferred/);
    expect(audit.nextQuestions.join(' ')).toMatch(/age-specific official guidance/);
  });
});
