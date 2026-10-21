import { describe, expect, it } from 'vitest';
import { parseLabel } from '../parser';
import { buildAudit } from '../engine';
import { defaultProfile, packageSchema, profileSchema, sourceSchema } from '../contracts';
import { detectAdditives, evidenceSources, lookupAdditive, resolveTentativeAdditiveIdentity, retrieveEvidence } from '../knowledge';

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
  it('describes a matched May-contain line as precautionary wording without implying cross-contact is absent',()=>{
    const pkg=label('Ingredients: oats\nMay contain traces of peanuts');
    const profile={...defaultProfile,allergies:'peanuts'};
    const audit=buildAudit(pkg,30,'g',profile,'Is this suitable for me?');
    const allergy=audit.findings.find(finding=>finding.title==='Food allergy: literal mention');
    const warning=pkg.observations.find(observation=>observation.field==='allergens'&&/may contain/i.test(observation.text));
    expect(allergy?.observationIds).toContain(warning?.id);
    expect(allergy?.detail).toContain('May-contain precautionary wording');
    expect(allergy?.detail).toContain('"May contain traces of peanuts"');
    expect(allergy?.detail).toMatch(/does not confirm that an allergen is present/i);
    expect(allergy?.detail).toMatch(/does not establish actual allergen presence, amount or exposure, individual risk or safety/i);
    expect(allergy?.detail).not.toMatch(/No matching “May contain” line|label may not show cross-contact/i);
    expect(allergy?.status).toBe('uncertain');
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
  it('answers every requested nutrient and maps calories to energy while keeping missing values unknown',()=>{
    const pkg=label('Per 100 g\nEnergy 180 kcal\nCarbohydrate 30 g\nSugars 4 g');
    const audit=buildAudit(pkg,30,'g',defaultProfile,'What does this nutrition label report for calories, carbohydrates, and sugars per serving?');
    expect(audit.answer).toContain('54 kcal energy');
    expect(audit.answer).toContain('9 g carbohydrate');
    expect(audit.answer).toContain('1.2 g total sugars');
    for(const key of ['energy','carbohydrate','sugars'] as const){
      const calc=audit.calculations.find(calculation=>calculation.nutrient===key)!;
      expect(audit.findings.some(finding=>finding.calculationIds.includes(calc.id)&&finding.observationIds.some(id=>calc.observationIds.includes(id)))).toBe(true);
    }

    const caloriesOnly=buildAudit(pkg,30,'g',defaultProfile,'How many calories are in this portion?');
    expect(caloriesOnly.answer).toContain('54 kcal energy');
    expect(caloriesOnly.answer).not.toContain('9 g carbohydrate');

    const missing=buildAudit(label('Per 100 g\nEnergy 180 kcal'),30,'g',defaultProfile,'How much sugar?');
    expect(missing.answer).toMatch(/total sugars for this portion is unknown.*Missing is not zero/i);
    expect(missing.answer).not.toMatch(/0 g total sugars/);
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
  it('summarizes conflicting package readings without choosing one and cites their observations',()=>{
    const pkg=label('Per 100 g\nSodium 850 mg\nSodium 85 mg\nIngredients: oats\nContains: milk');
    const audit=buildAudit(pkg,30,'g',defaultProfile,'What remains uncertain?');
    expect(audit.answer).toMatch(/Sodium needs confirmation/i);
    expect(audit.answer).toContain('Sodium 850 mg');expect(audit.answer).toContain('Sodium 85 mg');
    expect(audit.answer).toMatch(/not proof that information is absent|OCR readings remain unverified/i);
    const summary=audit.findings.find(item=>item.title==='Unresolved package evidence');
    expect(summary?.status).toBe('conflict');
    expect(summary?.observationIds).toEqual(expect.arrayContaining(pkg.nutrients.flatMap(nutrient=>nutrient.observationIds)));
  });
  it('reports a rejected nutrient row and its original observation as unresolved',()=>{
    const pkg=label('Per 100 g\nProtein <0.5 g\nIngredients: oats\nContains: milk');
    expect(pkg.nutrients.some(nutrient=>nutrient.key==='protein')).toBe(false);
    expect(pkg.parserDiagnostics?.some(diagnostic=>diagnostic.field==='protein'&&diagnostic.decision==='rejected')).toBe(true);
    const audit=buildAudit(pkg,30,'g',defaultProfile,'What is unknown about this package?');
    expect(audit.answer).toMatch(/Protein row.*approximate or bounded amount/i);
    expect(audit.answer).toContain('Protein <0.5 g');
    const summary=audit.findings.find(item=>item.title==='Unresolved package evidence');
    const rejectedRowId=pkg.parserDiagnostics!.find(diagnostic=>diagnostic.field==='protein')!.sourceObservationIds[0];
    expect(summary?.observationIds).toContain(rejectedRowId);
  });
  it('describes a clear recorded extraction without claiming OCR or uncaptured panels are verified',()=>{
    const pkg=label('Known oat snack\nPer 100 g\nProtein 8 g\nIngredients: oats\nContains: milk');
    const audit=buildAudit(pkg,30,'g',defaultProfile,'What remains uncertain?');
    expect(audit.answer).toMatch(/do not see a recorded nutrient conflict, rejected nutrition row, missing nutrient basis/i);
    expect(audit.answer).toMatch(/OCR can still misread text.*panel not captured remains unknown/i);
    expect(audit.findings.some(item=>item.title==='Unresolved package evidence')).toBe(false);
    expect(audit.answer).not.toMatch(/unsupported local question|local rule engine/);
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
  it('explains precautionary allergen wording separately from a Contains declaration and package facts',()=>{
    const pkg=label('Ingredients: Oats\nContains: Milk\nMay contain: Peanuts');
    const audit=buildAudit(pkg,30,'g',defaultProfile,'What does “May contain peanuts” mean according to FSSAI?');
    expect(audit.answer).toMatch(/separate “Contains \[allergen\]” declaration.*specified allergenic ingredients/i);
    expect(audit.answer).toMatch(/“May Contains \[allergen\]” declaration.*cross-contamination/i);
    expect(audit.answer).toMatch(/does not establish actual allergen presence, amount or exposure, individual risk or safety, or package compliance/i);
    expect(audit.answer).toMatch(/Current applicability to an exact package requires live checking/i);
    expect(audit.answer).not.toMatch(/this package contains peanuts|peanuts are present/i);
    expect(audit.sources.map(source=>source.id)).toEqual(expect.arrayContaining(['fssai-labelling-display-2020','fssai-labelling-allergen-faq-2023']));
    const reference=audit.findings.find(finding=>finding.sourceIds.includes('fssai-labelling-allergen-faq-2023'));
    expect(reference?.title).toMatch(/^Reference to inspect:/);
    expect(reference?.detail).toMatch(/does not establish that a particular allergen is actually present/i);
    expect(audit.trace.find(entry=>entry.tool==='local_rule_answer')?.status).toContain('no language model');
  });
  it('keeps current FSSAI allergen-compliance questions unresolved for live research',()=>{
    const audit=buildAudit(label('Ingredients: Oats\nMay contain: Peanuts'),30,'g',defaultProfile,'Is a “May contain peanuts” label compliant under current FSSAI rules?');
    expect(audit.answer).toMatch(/Current legal or regulatory status is unresolved/i);
    expect(audit.limitations.join(' ')).toMatch(/Static corpus entries do not establish current law/i);
    expect(audit.sources.map(source=>source.id)).toContain('fssai-labelling-allergen-faq-2023');
  });
  it('explains a recorded high-protein claim using dated FSSAI criteria without scoring the package',()=>{
    const pkg=parseLabel('Oat snack\nHigh protein\nPer 100 g\nProtein 8 g',{origin:'user'});
    const claimObservation=pkg.observations.find(observation=>observation.field==='claim'&&observation.text==='High protein')!;
    const audit=buildAudit(pkg,30,'g',defaultProfile,'What does this claim mean?');
    const reference=audit.findings.find(finding=>finding.title==='FSSAI nutrient-content claim wording (dated reference)');

    expect(audit.answer).toContain('20% of RDA per 100 g for solids');
    expect(audit.answer).toContain('10% per 100 ml for liquids');
    expect(audit.answer).toContain('10% per 100 kcal');
    expect(audit.answer).toContain('20% per serving');
    expect(audit.answer).toContain('“High protein” (user-entered observation)');
    expect(audit.answer).toMatch(/does not infer an applicable RDA|no RDA or reference group is inferred/i);
    expect(audit.answer).toMatch(/does not determine which product basis applies.*establish whether the product makes or meets the claim/i);
    expect(audit.answer).not.toContain('2.4 g protein');
    expect(reference?.status).toBe('uncertain');
    expect(reference?.observationIds).toContain(claimObservation.id);
    expect(reference?.sourceIds).toEqual(['fssai-advertising-claims-compendium-2022','fssai-advertising-claims-amendment-index']);
    expect(audit.sources.map(source=>source.id)).toEqual(expect.arrayContaining(reference!.sourceIds));
  });
  it.each([
    ['high/rich fibre','6 g per 100 g for solids','3 g per 100 ml for liquids','3 g per 100 kcal'],
    ['low sugars','not more than 5 g of sugars per 100 g for solids','2.5 g per 100 ml for liquids','No matching claim wording is retained'],
  ])('explains the dated %s criteria without inferring label values', (claim,...phrases)=>{
    const audit=buildAudit(label('Per 100 g\nFibre 8 g\nSugars 4 g'),30,'g',defaultProfile,`What does ${claim} mean?`);
    for(const phrase of phrases)expect(audit.answer).toContain(phrase);
    expect(audit.answer).toMatch(/general explanation|dated criteria do not determine/i);
    expect(audit.sources.map(source=>source.id)).toEqual(expect.arrayContaining(['fssai-advertising-claims-compendium-2022','fssai-advertising-claims-amendment-index']));
    expect(audit.trace.find(entry=>entry.tool==='explain_nutrient_content_claim')?.status).toContain('no compliance classifier');
  });
  it('does not classify package claim compliance and keeps current-rule questions unresolved',()=>{
    const pkg=label('High protein\nPer 100 g\nProtein 8 g');
    const notClassified=buildAudit(pkg,30,'g',defaultProfile,'Does this high protein package meet FSSAI criteria?');
    expect(notClassified.answer).toMatch(/does not determine whether the package qualifies for or complies/i);
    expect(notClassified.answer).not.toMatch(/the package (?:does|does not) qualify|the claim is compliant/i);
    const current=buildAudit(pkg,30,'g',defaultProfile,'Is this high protein package compliant under current FSSAI rules?');
    expect(current.answer).toMatch(/Current legal or regulatory status is unresolved/i);
    expect(current.answer).toMatch(/does not establish current applicability or compliance/i);
    expect(current.sources.map(source=>source.id)).toEqual(expect.arrayContaining(['fssai-advertising-claims-compendium-2022','fssai-advertising-claims-amendment-index']));
    expect(current.trace.some(entry=>entry.tool==='check_regulatory_updates'&&entry.status.includes('live research required'))).toBe(true);
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
    expect(lookupAdditive('potassium sorbate')?.code).toBe('202');
    expect(lookupAdditive('sodium benzoate')?.sourceIds).toEqual(['fao-211']);
    expect(lookupAdditive('FD&C Yellow No. 5')?.code).toBe('102');
    expect(lookupAdditive('calcium disodium edetate')?.code).toBe('385');
    expect(detectAdditives('Ingredients: flour, sweetener (955), xanthan gum (INS 415), E9550')).toEqual(expect.arrayContaining(['955','415']));
    expect(detectAdditives('Ingredients: potassium sorbate, sodium benzoate, tartrazine, calcium disodium EDTA')).toEqual(expect.arrayContaining(['102','202','211','385']));
    expect(detectAdditives('Barcode 9550000000000')).toEqual([]);
  });
  it('keeps a noisy multi-token additive match tentative and source-linked',()=>{
    const candidate=resolveTentativeAdditiveIdentity('Calciurn disodium edetate');
    expect(candidate).toMatchObject({
      status:'tentative',kind:'additive-identity-candidate',code:'385',name:'Calcium Disodium EDTA',
      observedText:'Calciurn disodium edetate',matchedAlias:'calcium disodium edetate',
      exactTokens:['disodium','edetate'],fuzzyTokens:[{observed:'calciurn',canonical:'calcium'}],
      sourceIds:['fao-385'],interpretation:'possible-identity-only; package-presence-not-established',
    });
    expect(candidate?.margin).toBeGreaterThanOrEqual(0.15);
    const hit=retrieveEvidence('Calciurn disodium edetate',4).find(item=>item.source.id==='fao-385');
    expect(hit?.method).toBe('local-concept-keyword+lexical+exact+tentative-additive-candidate');
    expect(hit?.tentativeAdditiveCandidate).toEqual(candidate);
    expect(hit?.tentativeCandidateScore).toBe(1);
    // The fuzzy resolver is additive-only: exact package-text detection remains unchanged.
    expect(detectAdditives('Ingredients: Calciurn disodium edetate')).toEqual([]);
  });
  it('surfaces noisy OCR additive identity only as an uncertain source-backed finding',()=>{
    const line='Calciurn disodium edetate';
    const pkg=parseLabel('Nutrition information\nPer 100 g\nSaturated fat 3.4 g',{origin:'ocr',observations:[
      {id:'raw-additive-385',field:'ocr-line',text:line,side:'back',origin:'ocr',confidence:48,imageId:'photo-back-1'},
    ]});
    const original=structuredClone(pkg);
    const audit=buildAudit(pkg,50,'g',defaultProfile,'What is uncertain?');
    const finding=audit.findings.find(item=>item.title==='Tentative additive identity candidate: INS 385 Calcium Disodium EDTA');
    expect(finding).toMatchObject({status:'uncertain',observationIds:['raw-additive-385'],sourceIds:['fao-385'],calculationIds:[]});
    expect(finding?.detail).toContain(line);
    expect(finding?.detail).toMatch(/tentative identity only/i);
    expect(audit.sources.map(source=>source.id)).toContain('fao-385');
    expect(audit.trace.find(item=>item.tool==='resolve_tentative_additive_identity')?.status).toContain('1 source-backed tentative candidate');
    expect(pkg).toEqual(original);
    expect(pkg.additives).toEqual([]);
    expect(pkg.nutrients).toEqual(original.nutrients);
  });
  it('does not match OCR phrase prefixes, overlong lines, non-OCR text or lines beyond the scan bound',()=>{
    const observations=[
      {id:'prefixed',field:'ocr-line',text:'Ingredients: Calciurn disodium edetate',side:'back' as const,origin:'ocr' as const,confidence:48},
      {id:'overlong',field:'ocr-line',text:`Calciurn disodium edetate ${'x'.repeat(140)}`,side:'back' as const,origin:'ocr' as const,confidence:48},
      {id:'derived-ingredients',field:'ingredients',text:'Calciurn disodium edetate',side:'back' as const,origin:'ocr' as const,confidence:48},
      {id:'user-entered',field:'ocr-line',text:'Calciurn disodium edetate',side:'back' as const,origin:'user' as const,confidence:48},
      ...Array.from({length:32},(_,index)=>({id:`noise-${index}`,field:'ocr-line',text:'No additive identity here',side:'back' as const,origin:'ocr' as const,confidence:40})),
      {id:'after-bound',field:'ocr-line',text:'Calciurn disodium edetate',side:'back' as const,origin:'ocr' as const,confidence:48},
    ];
    const pkg=parseLabel('Nutrition information\nPer 100 g\nSaturated fat 3.4 g',{origin:'ocr',observations});
    const audit=buildAudit(pkg,50,'g',defaultProfile);
    expect(audit.findings.some(item=>item.title.startsWith('Tentative additive identity candidate:'))).toBe(false);
    expect(pkg.additives).toEqual([]);
  });
  it('fails closed on single-token, short, unrelated, ambiguous and oversized phrases',()=>{
    expect(resolveTentativeAdditiveIdentity('calciurn')).toBeUndefined();
    expect(resolveTentativeAdditiveIdentity('sodium sulfate')).toBeUndefined();
    expect(resolveTentativeAdditiveIdentity('sodium benzoate potassium sorbate')).toBeUndefined();
    expect(resolveTentativeAdditiveIdentity('Calciurn disodium edetate '.padEnd(161,'x'))).toBeUndefined();
    expect(resolveTentativeAdditiveIdentity('sodium benzoate potassium sorbate tartrazine xanthan gum sucralose citric acid msg')).toBeUndefined();
    expect(resolveTentativeAdditiveIdentity('potassium sorbate')).toBeUndefined();
  });
  it('answers an additive-name question without implying the package contains it',()=>{
    const audit=buildAudit(label('Per 100 g\nEnergy 100 kcal'),30,'g',defaultProfile,'What is potassium sorbate?');
    expect(audit.answer).toMatch(/INS 202 is Potassium Sorbate/);
    expect(audit.answer).toMatch(/does not establish that this package contains it/);
    expect(audit.sources.map(source=>source.id)).toContain('fao-202');
  });
  it('retrieves named authoritative sources with bounded inspectable scores',()=>{
    expect(retrieveEvidence('high blood pressure salty snack')[0].source.id).toBe('who-sodium');
    expect(retrieveEvidence('INS 955')[0].source.id).toBe('fao-955');
    expect(retrieveEvidence('INS 211')[0].source.id).toBe('fao-211');
    expect(retrieveEvidence('INS 202')[0].source.id).toBe('fao-202');
    expect(retrieveEvidence('INS 102')[0].source.id).toBe('fao-102');
    expect(retrieveEvidence('sweeteners weight control').some(h=>h.source.id==='who-nss')).toBe(true);
    expect(retrieveEvidence('ICMR India dietary guidelines').some(h=>h.source.id==='icmrnin-dgi-2024')).toBe(true);
    const diabetes=retrieveEvidence('Does everyone with diabetes need to count carbs? What other meal planning methods are available?');
    expect(diabetes[0]?.source.id).toBe('niddk-meals');
    expect(diabetes[0]?.source.summary).toMatch(/not everyone with diabetes needs to count carbs/i);
    expect(diabetes[0]?.source.retrievedAt).toBe('2026-10-21');
    const fibre=retrieveEvidence('WHO adult naturally occurring dietary fibre 25 g daily');
    expect(fibre[0]?.source.id).toBe('who-carbohydrate-2023');
    expect(fibre[0]?.source.summary).toMatch(/at least 25 g\/day of naturally occurring dietary fibre/);
    expect(fibre[0]?.source.summary).toMatch(/15 g\/day at ages 2–5, 21 g\/day at ages 6–9, and 25 g\/day at ages 10 or older/);
    expect(fibre[0]?.source.summary).toMatch(/400 g\/day of vegetables and fruits/);
    expect(fibre[0]?.source.limitations).toMatch(/refers to fibre as consumed in foods/);
    expect(fibre[0]?.source.limitations).toMatch(/cannot be directly equated with a packaged-food fibre declaration/);
    expect(fibre[0]?.source.url).toBe('https://www.who.int/publications/i/9789240073593');
    const allergen=retrieveEvidence('What does May contain mean for cross contamination and allergen labels?');
    expect(allergen[0]?.source.id).toBe('fssai-labelling-allergen-faq-2023');
    expect(allergen[0]?.source.summary).toMatch(/“Contains \[allergen\]”.*“May Contains \[allergen\]”/);
    expect(allergen[0]?.source.limitations).toMatch(/current regulation, subsequent amendments or directions/);
    expect(retrieveEvidence('FSSAI regulation May contain allergen cross contamination',5).some(hit=>hit.source.id==='fssai-labelling-display-2020')).toBe(true);
    const proteinClaim=retrieveEvidence('FSSAI high protein claim threshold');
    expect(proteinClaim[0]?.source.id).toBe('fssai-advertising-claims-compendium-2022');
    expect(proteinClaim[0]?.source.summary).toMatch(/20% of RDA per 100 g for solids.*20% per serving/i);
    const claimIndex=retrieveEvidence('Advertising and Claims FSSAI amendments',5).find(hit=>hit.source.id==='fssai-advertising-claims-amendment-index');
    expect(claimIndex?.source.summary).toMatch(/three amendments.*13 December 2022/i);
    expect(retrieveEvidence('What does WHO mean by free sugars?')[0]?.source.id).toBe('who-sugars-2015');
    expect(evidenceSources.every(s=>sourceSchema.safeParse(s).success)).toBe(true);
    expect(evidenceSources.every(s=>typeof s.license==='string'&&s.license.trim().length>0)).toBe(true);
    expect(evidenceSources.find(s=>s.id==='who-nss')?.license).toMatch(/terms not independently verified/i);
    expect(()=>retrieveEvidence('query',0)).toThrow();
  });
  it('retrieves WHO free-sugar guidance without treating total package sugars as daily free sugars',()=>{
    const audit=buildAudit(label('Per 100 g\nSugars 12 g\nAdded sugars 5 g'),30,'g',defaultProfile,'What does WHO mean by free sugars?');
    expect(audit.calculations.find(calculation=>calculation.nutrient==='sugars')?.result).toBe(3.6);
    expect(audit.calculations.find(calculation=>calculation.nutrient==='addedSugars')?.result).toBe(1.5);
    const source=audit.sources.find(item=>item.id==='who-sugars-2015');
    expect(source?.summary).toMatch(/less than 10% of total daily energy/i);
    expect(source?.summary).toMatch(/fruit-juice concentrates/i);
    expect(source?.limitations).toMatch(/not a product threshold/i);
    expect(audit.findings.some(finding=>finding.sourceIds.includes('who-sugars-2015'))).toBe(true);
    expect(audit.answer).not.toMatch(/3\.6 g.*free sugars/i);
  });
  it.each([
    'What does WHO recommend about dietary fibre?',
    'What guidance does WHO give about whole grains in the diet?',
    'What are the daily recommendations for pulses and legumes?',
    'What does dietary carbohydrate quality guidance say?',
  ])('surfaces whole-diet WHO carbohydrate guidance for "%s" while preserving the package amount',question=>{
    const audit=buildAudit(label('Per 100 g\nFibre 8 g'),30,'g',defaultProfile,question);
    const reference=audit.findings.find(finding=>finding.sourceIds.includes('who-carbohydrate-2023'));
    expect(reference?.title).toMatch(/^Reference to inspect:/);
    expect(reference?.detail).toMatch(/not a package-specific threshold|cannot be directly equated with a packaged-food fibre declaration/i);
    expect(audit.sources.some(source=>source.id==='who-carbohydrate-2023')).toBe(true);
    expect(audit.calculations.find(calculation=>calculation.nutrient==='fiber')?.result).toBe(2.4);
    expect(audit.answer).toMatch(/WHO’s 2023 guideline recommends that carbohydrates come primarily from whole grains, vegetables, fruits and pulses/i);
    expect(audit.answer).toMatch(/not a product-specific threshold or individual prescription/i);
    if(/fib(?:er|re)/i.test(question)){
      expect(audit.answer).toMatch(/adults.*25 g\/day of naturally occurring dietary fibre/i);
      expect(audit.answer).toMatch(/2\.4 g fibre/i);
      expect(audit.answer).toMatch(/not a measure of whole-day intake/i);
    }else{
      expect(audit.answer).not.toMatch(/\b(?:25|2\.4) g\b/i);
      expect(audit.answer).not.toMatch(/No personal context was provided/i);
    }
  });
  it('answers whole-grain guidance without inventing a package or pulse serving amount',()=>{
    const audit=buildAudit(label('Per 100 g\nEnergy 180 kcal'),30,'g',defaultProfile,'What guidance does WHO give about whole grains in the diet?');
    expect(audit.answer).toMatch(/carbohydrates come primarily from whole grains, vegetables, fruits and pulses/i);
    expect(audit.answer).toMatch(/population guidance for the whole diet/i);
    expect(audit.answer).not.toMatch(/\b\d+\s*g\b/i);
    expect(audit.sources.some(source=>source.id==='who-carbohydrate-2023')).toBe(true);
    expect(audit.calculations.some(calculation=>calculation.nutrient==='fiber')).toBe(false);
  });
  it('answers child fibre guidance with WHO age bands and leaves a missing package amount unknown',()=>{
    const audit=buildAudit(label('Per 100 g\nEnergy 180 kcal'),30,'g',defaultProfile,'What does WHO recommend about fibre for children?');
    expect(audit.answer).toMatch(/children and adolescents.*15 g\/day.*ages 2–5.*21 g\/day.*ages 6–9.*25 g\/day.*ages 10 or older/i);
    expect(audit.answer).toMatch(/naturally occurring dietary fibre from foods/i);
    expect(audit.answer).not.toMatch(/For adults, it recommends at least 25 g\/day/i);
    expect(audit.answer).toMatch(/no usable package fibre reading.*portion amount remains unknown/i);
    expect(audit.calculations.some(calculation=>calculation.nutrient==='fiber')).toBe(false);
    expect(audit.sources.find(source=>source.id==='who-carbohydrate-2023')?.limitations).toMatch(/whole-diet quality/);
  });
  it('does not attach whole-diet guidance to a simple package fibre-amount question',()=>{
    const audit=buildAudit(label('Per 100 g\nFibre 8 g'),30,'g',defaultProfile,'How much fibre is in 30 g?');
    expect(audit.calculations.find(calculation=>calculation.nutrient==='fiber')?.result).toBe(2.4);
    expect(audit.answer).toMatch(/2\.4 g fibre/i);
    expect(audit.sources.some(source=>source.id==='who-carbohydrate-2023')).toBe(false);
    expect(audit.findings.some(finding=>finding.sourceIds.includes('who-carbohydrate-2023'))).toBe(false);
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
