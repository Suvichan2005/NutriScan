import {z} from 'zod';
import type {FunctionDeclaration} from '@google/genai';
import scope from '../../../data/semester-source-roles.json';

export const toolAccessInput=z.object({
  mode:z.enum(['ordinary','specialized','research']),
  names:z.array(z.string().regex(/^[a-z_]{1,64}$/)).max(20).optional(),
}).strict().superRefine((value,ctx)=>{
  if(value.mode==='research'&&!value.names)ctx.addIssue({code:'custom',path:['names'],message:'Research mode requires an explicit tool subset.'});
  if(value.mode!=='research'&&value.names)ctx.addIssue({code:'custom',path:['names'],message:'Only controlled research mode accepts an explicit tool subset.'});
  if(value.names&&new Set(value.names).size!==value.names.length)ctx.addIssue({code:'custom',path:['names'],message:'Tool names must be unique.'});
});

/** Explicit capability selection; no question/condition classification. */
export function selectAgentTools(catalog:FunctionDeclaration[],hasImages:boolean,input?:z.input<typeof toolAccessInput>){
  const access=toolAccessInput.parse(input??{mode:'ordinary'});
  const eligible=new Map(catalog.flatMap(tool=>tool.name?[[tool.name,tool]as const]:[]));
  const selected=access.mode==='ordinary'?scope.toolInventory.ordinary:access.mode==='research'?access.names!:Array.from(eligible.keys());
  if(selected.some(name=>!eligible.has(name)))throw new Error('The selected tool profile contains an unavailable capability.');
  const declarations=selected.flatMap(name=>name==='inspect_package_image'&&!hasImages?[]:[eligible.get(name)!]);
  return{mode:access.mode,declarations,names:declarations.map(tool=>tool.name!),schemaBytes:Buffer.byteLength(JSON.stringify(declarations))};
}
