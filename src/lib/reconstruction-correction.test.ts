import {expect,it} from 'vitest';
import {parseLabel} from './parser';
import {packageSchema} from './contracts';
import {applyReconstructionRowCorrection,packageWithRowCorrections} from './reconstruction-correction';
import {calculationRespectsCorrections} from './correction';
import {packageForAssist} from './assist-evidence';
import {assistInput,assistPromptPayload} from './server/gemini';
import {executeGeminiTool,type GeminiToolContext} from './server/gemini-tools';

function fixture(){
 const pkg=parseLabel('Developer calculation fixture, not a package photo.');
 pkg.observations.push({id:'reference',field:'raw-text',origin:'fixture',side:'text',confidence:null,text:'Developer authored calcium and iron example.'});
 const row={rowId:'calcium',nutrient:'Calcium',nutrientKey:null,printedLabel:'Calcium',printedValue:'142 mg',value:142,unit:'mg',columnLabel:null,basisText:'per 150 ml',basisAmount:150,basisUnit:'ml' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:['reference'],imageRegions:[]}};
 pkg.reconstruction={identity:{brand:null,name:'Developer fixture',variant:null,status:'provisional',evidence:{observationIds:['reference'],imageRegions:[]}},serving:null,nutritionRows:[row,{...row,rowId:'iron',nutrient:'Iron',printedLabel:'Iron',value:4}],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Developer arithmetic fixture.',revision:1,current:true,updatedAt:new Date().toISOString(),model:'fixture'};
 return packageSchema.parse(pkg);
}
const edit={rowId:'calcium',label:'Calcium',value:200,unit:'mg' as const,basisAmount:150,basisUnit:'ml' as const,qualifier:null};
function calculate(pkg:ReturnType<typeof fixture>,id='calcium'){
 const context:GeminiToolContext={question:'Calculate half a serving.',package:pkg,visualImages:[],searchTerms:new Set(),prepareImage:async image=>image.base64};
 return executeGeminiTool('calculate_nutrition',{candidateId:id,amount:75,unit:'ml'},context);
}

it('retains original model evidence while updating native calculation, compact follow-up and saved state',async()=>{
 const original=fixture(),old=await calculate(original);
 const corrected=applyReconstructionRowCorrection(original,edit);
 expect(calculationRespectsCorrections(original,{...old.calculations![0],inputOrigin:'user-correction'})).toBe(false);
 expect(corrected.reconstruction).toEqual(original.reconstruction);
 expect(corrected.observations).toHaveLength(original.observations.length+1);
 expect(corrected.reconstructionCorrections?.[0].original.value).toBe(142);
 expect(packageWithRowCorrections(corrected).reconstruction?.nutritionRows.find(row=>row.rowId==='calcium')?.value).toBe(200);
 const result=await calculate(corrected);expect(result.calculations?.[0].result).toBe(100);
 expect(result.calculations?.[0].assumptions.join(' ')).toContain('user correction');
 expect(result.calculations?.[0].evidenceText).toContain('recorded user correction');
 expect(calculationRespectsCorrections(corrected,old.calculations![0])).toBe(false);
 const unrelated=await calculate(corrected,'iron');expect(unrelated.calculations?.[0].result).toBe(2);
 const saved=packageSchema.parse(JSON.parse(JSON.stringify(corrected)));
 const input=assistInput.parse({consent:true,question:'What about half?',package:packageForAssist(saved),images:[],visualImages:[]});
 expect(JSON.stringify(assistPromptPayload(input))).toContain('200');
 expect((await calculate(saved)).calculations?.[0].result).toBe(100);
});

it('preserves corrections through a recheck that changes row IDs and through subsequent edits',async()=>{
 let pkg=applyReconstructionRowCorrection(fixture(),edit);
 pkg={...pkg,reconstruction:{...pkg.reconstruction!,revision:2,nutritionRows:pkg.reconstruction!.nutritionRows.map(row=>row.rowId==='calcium'?{...row,rowId:'new-model-id',value:143}:row)}};
 expect((await calculate(pkg)).calculations?.[0].result).toBe(100);
 pkg=applyReconstructionRowCorrection(pkg,{...edit,label:'Calcium declared',value:220});
 expect(pkg.reconstructionCorrections?.[0]).toMatchObject({revision:2,sourceRevision:1,original:{value:142},reading:{value:220}});
 expect((await calculate(pkg)).calculations?.[0].result).toBe(110);
 expect(packageWithRowCorrections(pkg).reconstruction?.nutritionRows.filter(row=>row.rowId==='calcium')).toHaveLength(1);
});

it('supports micrograms and zero but withholds qualifiers, invalid edits and forged provenance',async()=>{
 const zero=applyReconstructionRowCorrection(fixture(),{...edit,value:0,unit:'µg'});
 expect((await calculate(zero)).calculations?.[0].result).toBe(0);
 const qualified=applyReconstructionRowCorrection(fixture(),{...edit,qualifier:'<'});
 expect((await calculate(qualified)).status).toBe('withheld');
 for(const invalid of [{value:-1},{value:NaN},{basisAmount:0},{label:''},{rowId:'unknown'},{unit:'%'},{qualifier:'approximately'}])expect(()=>applyReconstructionRowCorrection(fixture(),{...edit,...invalid} as typeof edit)).toThrow();
 const forged=applyReconstructionRowCorrection(fixture(),edit);forged.reconstructionCorrections![0].observationId='reference';expect(packageSchema.safeParse(forged).success).toBe(false);
});
