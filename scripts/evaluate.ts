import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseLabel } from '../src/lib/parser';
import { buildAudit } from '../src/lib/engine';
import { defaultProfile, type NutrientKey } from '../src/lib/contracts';

const suiteVersion='core-synthetic-v1.1';
type ExpectedField={key:NutrientKey;value:number;unit:string;basis:number|null;status?:string};
type ExpectedCalc={key:NutrientKey;value:number};
type Case={id:string;text:string;portion:number;unit:'g'|'ml';fields:ExpectedField[];calculations:ExpectedCalc[];withheld?:NutrientKey[];absent?:NutrientKey[]};
const field=(key:NutrientKey,value:number,unit:string,basis:number|null=100,status?:string):ExpectedField=>({key,value,unit,basis,status});
const cases:Case[]=[
  {id:'explicit-zero',text:'Per 100 g\nSugars 0 g\nProtein 12 g',portion:25,unit:'g',fields:[field('sugars',0,'g'),field('protein',12,'g')],calculations:[{key:'sugars',value:0},{key:'protein',value:3}],absent:['sodium']},
  {id:'declared-serving',text:'Serving size: 25 g\nPer serving\nCarbohydrate 10 g',portion:50,unit:'g',fields:[field('carbohydrate',10,'g',25)],calculations:[{key:'carbohydrate',value:20}]},
  {id:'volume-basis',text:'Per 100 ml\nSugars 10.6 g',portion:330,unit:'ml',fields:[field('sugars',10.6,'g')],calculations:[{key:'sugars',value:34.98}]},
  {id:'sodium-grams',text:'Per 100 g\nSodium 0.8 g',portion:25,unit:'g',fields:[field('sodium',.8,'g')],calculations:[{key:'sodium',value:200}]},
  {id:'salt-derived-sodium',text:'Per 100 g\nSalt 2 g',portion:25,unit:'g',fields:[field('salt',2,'g')],calculations:[{key:'salt',value:.5},{key:'sodium',value:200}]},
  {id:'dual-column-withheld',text:'Per: 100 ml 330 ml\nCarbohydrate 10.6 g 35 g\nOf which sugars 10.6 g 35 g',portion:330,unit:'ml',fields:[field('carbohydrate',10.6,'g',null,'conflict'),field('carbohydrate',35,'g',null,'conflict'),field('sugars',10.6,'g',null,'conflict'),field('sugars',35,'g',null,'conflict')],calculations:[],withheld:['carbohydrate','sugars']},
  {id:'conflicting-ocr',text:'Per 100 g\nSodium 850 mg\nSodium 85 mg',portion:30,unit:'g',fields:[field('sodium',850,'mg',100,'conflict'),field('sodium',85,'mg',100,'conflict')],calculations:[],withheld:['sodium']},
  {id:'missing-basis',text:'Carbohydrate 60 g',portion:30,unit:'g',fields:[field('carbohydrate',60,'g',null)],calculations:[],withheld:['carbohydrate']},
  {id:'bounded-not-exact',text:'Per 100 g\nSugars < 0.5 g',portion:30,unit:'g',fields:[],calculations:[],withheld:['sugars'],absent:['sugars']},
  {id:'negative-withheld',text:'Per 100 g\nProtein -2 g',portion:30,unit:'g',fields:[],calculations:[],withheld:['protein'],absent:['protein']},
  {id:'unit-missing',text:'Per 100 g\nSodium 800',portion:30,unit:'g',fields:[],calculations:[],withheld:['sodium'],absent:['sodium']},
  {id:'percentage-column',text:'Per 100 g\nProtein (g) 12 20%',portion:30,unit:'g',fields:[field('protein',12,'g')],calculations:[{key:'protein',value:3.6}]},
  {id:'mass-volume-incompatible',text:'Per 100 ml\nSugars 10 g',portion:30,unit:'g',fields:[field('sugars',10,'g')],calculations:[],withheld:['sugars']},
  {id:'equivalent-bases',text:'Per 100 g\nCarbohydrate 60 g\nPer 25 g\nCarbohydrate 15 g',portion:50,unit:'g',fields:[field('carbohydrate',60,'g'),field('carbohydrate',15,'g',25)],calculations:[{key:'carbohydrate',value:30}]},
  {id:'inverted-sugar-totals',text:'Per 100 g\nCarbohydrate 10 g\nSugars 20 g',portion:30,unit:'g',fields:[field('carbohydrate',10,'g'),field('sugars',20,'g')],calculations:[],withheld:['carbohydrate','sugars']},
  {id:'french-alias-decimal',text:'Pour 100 g\nGlucides 57,5 g\ndont sucres 56,3 g\nProtéines 6,3 g',portion:15,unit:'g',fields:[field('carbohydrate',57.5,'g'),field('sugars',56.3,'g'),field('protein',6.3,'g')],calculations:[{key:'carbohydrate',value:8.625},{key:'sugars',value:8.445},{key:'protein',value:.945}]},
  {id:'spanish-alias-decimal',text:'Para 100 g\nGrasas 30,9 g\nSal 0,1 g',portion:20,unit:'g',fields:[field('fat',30.9,'g'),field('salt',.1,'g')],calculations:[{key:'fat',value:6.18},{key:'salt',value:.02},{key:'sodium',value:8}]},
  {id:'energy-unit-header',text:'Per 100 ml\nEnergy (kJ/kcal) 180/42\nSugars 10.6 g',portion:100,unit:'ml',fields:[field('energy',180,'kJ',null,'conflict'),field('energy',42,'kcal',null,'conflict'),field('sugars',10.6,'g')],calculations:[{key:'sugars',value:10.6}],withheld:['energy']},
  {id:'split-per-header',text:'Per:\n100 ml\nSugars 10 g',portion:200,unit:'ml',fields:[field('sugars',10,'g')],calculations:[{key:'sugars',value:20}]},
  {id:'tiny-salt-no-intermediate-rounding',text:'Per 100 g\nSalt 0.0001 g',portion:1,unit:'g',fields:[field('salt',.0001,'g')],calculations:[{key:'salt',value:.000001},{key:'sodium',value:.0004}]},
];

let fieldTotal=0,fieldCorrect=0,absenceTotal=0,absenceCorrect=0,withheldTotal=0,withheldCorrect=0,calculationTotal=0;
const errors:number[]=[];
const results=cases.map(test=>{
  const pkg=parseLabel(`Synthetic evaluation case ${test.id}\n${test.text}`,{origin:'fixture',synthetic:true});
  const audit=buildAudit(pkg,test.portion,test.unit,defaultProfile,'What does this label mean?');
  const matches=test.fields.map(expected=>{
    fieldTotal++;
    const match=pkg.nutrients.some(n=>n.key===expected.key&&Math.abs(n.value-expected.value)<1e-10&&n.unit===expected.unit&&(n.basis?.amount??null)===expected.basis&&(!expected.status||n.status===expected.status));
    if(match)fieldCorrect++;return {expected,match};
  });
  const numeric=test.calculations.map(expected=>{
    calculationTotal++;const actual=audit.calculations.find(c=>c.nutrient===expected.key)?.result;
    const absoluteError=actual===undefined?null:Math.abs(actual-expected.value);if(absoluteError!==null)errors.push(absoluteError);
    return {key:expected.key,expected:expected.value,actual:actual??null,absoluteError,pass:absoluteError!==null&&absoluteError<1e-9};
  });
  const withholding=(test.withheld??[]).map(key=>{withheldTotal++;const pass=!audit.calculations.some(c=>c.nutrient===key);if(pass)withheldCorrect++;return {key,pass};});
  const absence=(test.absent??[]).map(key=>{absenceTotal++;const pass=!pkg.nutrients.some(n=>n.key===key);if(pass)absenceCorrect++;return {key,pass};});
  return {id:test.id,synthetic:true,pass:matches.every(m=>m.match)&&numeric.every(n=>n.pass)&&withholding.every(n=>n.pass)&&absence.every(n=>n.pass),fields:matches,numeric,withholding,absence};
});
const receipt={suiteVersion,runAt:new Date().toISOString(),dataClass:'synthetic developer examples; no image OCR or provider requests',summary:{cases:cases.length,casesPassed:results.filter(r=>r.pass).length,annotatedFieldsCorrect:fieldCorrect,annotatedFieldsTotal:fieldTotal,annotatedAbsencesCorrect:absenceCorrect,annotatedAbsencesTotal:absenceTotal,withholdingCorrect:withheldCorrect,withholdingTotal:withheldTotal,calculationsCompared:calculationTotal,maxAbsoluteNumericalError:Math.max(0,...errors),meanAbsoluteNumericalError:errors.reduce((a,b)=>a+b,0)/Math.max(1,errors.length)},limitations:['Small developer-authored synthetic suite, used during implementation; not an independent held-out benchmark.','Important annotated field matching only; not total OCR character accuracy, label-level accuracy or population generalization.','No real photos, model/provider acceptance, medical suitability, regulatory conclusions or retrieval-quality metrics are established.'],results};
async function persist(){
  const output=resolve('docs/evidence/core-evaluation.json');await mkdir(resolve('docs/evidence'),{recursive:true});await writeFile(output,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({suiteVersion,output,summary:receipt.summary,limitations:receipt.limitations},null,2));
  if(results.some(r=>!r.pass))process.exitCode=1;
}
void persist().catch(error=>{console.error(error instanceof Error?error.message:'Evaluation output failed.');process.exitCode=1;});
