import {expect,it} from 'vitest';
import {nutrientMassConflict,checkReconstructionMasses} from './nutrient-mass';
import {parseLabel} from './parser';
import {applyNutrientCorrection,calculationRespectsCorrections} from './correction';
import {calculationsFromReconstruction} from './portion';
import {executeGeminiTool,type GeminiToolContext} from './server/gemini-tools';
import type {PackageReconstructionContent} from './contracts';
const evidence={observationIds:['source'],imageRegions:[]};
const row={rowId:'carb',nutrient:'Carbohydrate',nutrientKey:'carbohydrate' as const,printedLabel:'Carbohydrate',printedValue:'860',value:860,unit:'g',columnLabel:null,basisText:'per 100 g',basisAmount:100,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence};
const content:PackageReconstructionContent={identity:{name:'Developer unit-invariant fixture',brand:null,variant:null,status:'provisional',evidence},serving:null,nutritionRows:[row,{...row,rowId:'sodium',nutrient:'Sodium',nutrientKey:'sodium',value:860,unit:'mg'}],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Developer fixture, not independent photo truth'};
function packet(){const pkg=parseLabel('Developer unit-invariant fixture.');pkg.observations.push({id:'source',field:'raw-text',text:'Developer quantity input',origin:'fixture',side:'text',confidence:null});pkg.reconstruction={...structuredClone(content),revision:1,updatedAt:'2026-10-26T00:00:00Z',model:'fixture',current:true};return pkg;}

it('converts compatible mass units and preserves zero, exact mass, and dimension limits',()=>{
 expect(nutrientMassConflict(row)).toBeTruthy();expect(nutrientMassConflict({...row,value:102,nutrientKey:'fiber'})).toBeTruthy();
 expect(nutrientMassConflict({...row,value:100001,unit:'mg',nutrientKey:'sodium'})).toBeTruthy();
 for(const unit of ['µg','μg','ug','mcg'])expect(nutrientMassConflict({...row,value:100000001,unit,nutrientKey:'sodium'})).toBeTruthy();
 for(const value of [0,30,100,100+Number.EPSILON])expect(nutrientMassConflict({...row,value})).toBeNull();
 expect(nutrientMassConflict({...row,unit:'mg',nutrientKey:'sodium'})).toBeNull();
 expect(nutrientMassConflict({...row,basisUnit:'ml'})).toBeNull();expect(nutrientMassConflict({...row,basisAmount:null})).toBeNull();
 for(const nutrientKey of ['energy','salt',null]as const)expect(nutrientMassConflict({...row,nutrientKey})).toBeNull();
});
it('respects inequality direction without assuming an exact quantity',()=>{
 expect(nutrientMassConflict({...row,qualifier:'<'})).toBeNull();expect(nutrientMassConflict({...row,qualifier:'<='})).toBeNull();
 expect(nutrientMassConflict({...row,qualifier:'>='})).toBeTruthy();expect(nutrientMassConflict({...row,value:100,qualifier:'>'})).toBeTruthy();expect(nutrientMassConflict({...row,value:100,qualifier:'>='})).toBeNull();
});
it('retains original values and provenance while recording conflicts without mutating provider content',()=>{
 const before=structuredClone(content),checked=checkReconstructionMasses(content);expect(content).toEqual(before);expect(checked.issues).toHaveLength(1);expect(checked.content.nutritionRows[0]).toEqual({...row,status:'conflict'});expect(checked.content.nutritionRows[1].status).toBe('provisional');expect(checked.content.unresolved[0].evidence).toEqual(evidence);expect(checkReconstructionMasses(checked.content).content.unresolved).toHaveLength(1);
});
it('prevents fresh and previously saved impossible rows from portion and native tool calculations',async()=>{
 const pkg=packet(),context:GeminiToolContext={question:'Calculate the requested amount',package:pkg,visualImages:[],searchTerms:new Set(),prepareImage:async image=>image.base64};
 expect(calculationsFromReconstruction(pkg,35,'g').map(c=>c.nutrient)).toEqual(['sodium']);
 for(const args of [{nutrient:'carbohydrate',amount:35,unit:'g'},{candidateId:'carb',amount:35,unit:'g'}])expect(await executeGeminiTool('calculate_nutrition',args,context)).toMatchObject({status:'withheld',resultCount:0});
 const sodium=await executeGeminiTool('calculate_nutrition',{nutrient:'sodium',amount:35,unit:'g'},context);expect(sodium.status).toBe('ok');expect(sodium.calculations![0].result).toBe(301);
 const legacy={...pkg,reconstruction:undefined,nutrients:[{key:'carbohydrate' as const,value:860,unit:'g' as const,basis:{amount:100,unit:'g' as const,description:'per 100 g'},observationIds:['source'],status:'observed' as const}]};
 expect(await executeGeminiTool('calculate_nutrition',{nutrient:'carbohydrate',amount:35,unit:'g'},{...context,package:legacy})).toMatchObject({status:'withheld'});
});
it('rejects impossible user entries before mutation and stale calculation reuse',()=>{
 const pkg=packet(),before=structuredClone(pkg);expect(()=>applyNutrientCorrection(pkg,{key:'carbohydrate',value:860,unit:'g',basisAmount:100,basisUnit:'g'})).toThrow('exceeds');expect(pkg).toEqual(before);
 const valid=calculationsFromReconstruction(pkg,35,'g')[0];expect(calculationRespectsCorrections(pkg,{...valid,nutrient:'carbohydrate',input:860,inputUnit:'g',basisAmount:100,portionUnit:'g'})).toBe(false);
});
