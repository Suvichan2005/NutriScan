import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { z } from 'zod';

const sourceSha256='5181661e921651d4087b544981e1e5a63b99532844eac0112732806a00a85eda';
export const openFoodToxSections={
  'reference-values':['FLEX_SUM.ToxRefValues'],
  'human-health':['END_STUDY_REC.HumanHealth'],
  'animal-health':['END_STUDY_REC.AnimalHealth'],
  environment:['END_STUDY_REC.TerrestEcotox','END_STUDY_REC.AquaticEcotox','END_STUDY_REC.EnvFateBehaviour'],
  properties:['END_STUDY_REC.PhysChemProps'],
  summaries:['END_SUM'],composition:['FLEX_REC'],metabolites:['FLEX_SUM.Metabolites'],
} as const;
export const openFoodToxDetailInput=z.object({
  substanceId:z.string().uuid(),section:z.enum(['overview','reference-values','human-health','animal-health','environment','properties','summaries','composition','metabolites']).default('overview'),
  recordId:z.string().regex(/^[A-Za-z0-9_.]+:[1-9][0-9]{0,6}$/).optional(),
  fields:z.array(z.string().min(1).max(250)).min(1).max(6).optional(),offset:z.number().int().min(0).max(300000).default(0),limit:z.number().int().min(1).max(5).default(3),
}).strict().refine(value=>!value.fields||!!value.recordId,{message:'Select an exact record before requesting specific fields.'});
type Input=z.input<typeof openFoodToxDetailInput>;
type SourceRow={sheet:string;source_row:number;document_id:string|null;parent_id:string|null;endpoint:string|null;cells_json:string};
export type OpenFoodToxRecord={recordId:string;documentId:string|null;parentId:string|null;section:string;endpoint:string|null;fields:Record<string,string|number|boolean>;availableFields:string[];truncatedFields:string[];missingFields:string[];selectedFieldsComplete:boolean;links:Array<{field:string;targetId:string;targetType:string;records:string[]}>;otherRowsForDocument:number};

/** Read exact source records; no source text, dose or study conclusion is inferred. */
export async function readOpenFoodToxRecords(input:Input,databasePath=path.join(process.cwd(),'.data/knowledge/openfoodtox-3.0.sqlite')){
  const args=openFoodToxDetailInput.parse(input);
  try{const file=await stat(databasePath);if(file.size>600_000_000)throw new Error('size');}
  catch(error){return{status:'unavailable' as const,reason:(error as NodeJS.ErrnoException).code==='ENOENT'?'not-imported':'invalid-store',results:[]};}
  let db:DatabaseSync;
  try{db=new DatabaseSync(databasePath,{readOnly:true});}
  catch{return{status:'unavailable' as const,reason:'invalid-store',results:[]};}
  try{
    const manifest=JSON.parse((db.prepare("SELECT value FROM metadata WHERE key='manifest'").get() as {value:string}).value);
    if(manifest.schemaVersion!==1||manifest.sourceSha256!==sourceSha256)throw new Error('source');
    const source=JSON.parse((db.prepare("SELECT value FROM metadata WHERE key='source'").get() as {value:string}).value);
    const substance=db.prepare("SELECT document_id,cells_json FROM records WHERE sheet='SUB' AND document_id=? LIMIT 1").get(args.substanceId) as {document_id:string;cells_json:string}|undefined;
    if(!substance)return{status:'no_match' as const,source,results:[]};
    const counts=db.prepare('SELECT sheet,COUNT(*) AS rows,COUNT(DISTINCT document_id) AS documents FROM records WHERE parent_id=? GROUP BY sheet').all(args.substanceId) as Array<{sheet:string;rows:number;documents:number}>;
    const relatedIds=new Set((db.prepare('SELECT DISTINCT l.target_id FROM links l JOIN records r ON r.sheet=l.sheet AND r.source_row=l.source_row WHERE r.parent_id=? OR r.document_id=?').all(args.substanceId,args.substanceId) as Array<{target_id:string}>).map(row=>row.target_id));
    for(const row of db.prepare("SELECT DISTINCT dossier.target_id FROM links subject JOIN links dossier ON dossier.sheet=subject.sheet AND dossier.source_row=subject.source_row WHERE subject.sheet='DOSSIER_DOCS' AND subject.field='DOCUMENT UUID' AND subject.target_id=? AND dossier.field='DOSSIER UUID'").all(args.substanceId) as Array<{target_id:string}>)relatedIds.add(row.target_id);
    if(args.section==='overview'&&!args.recordId)return{status:'ok' as const,source,substanceId:args.substanceId,coverage:counts,results:[],relatedRecords:[...relatedIds].slice(0,40).flatMap(id=>(db.prepare("SELECT sheet,source_row FROM records WHERE document_id=? AND sheet IN ('LIT','DOSSIER','REF_SUB') LIMIT 2").all(id) as Array<{sheet:string;source_row:number}>).map(row=>({recordId:`${row.sheet}:${row.source_row}`,kind:row.sheet==='REF_SUB'?'substance-identity':row.sheet==='LIT'?'scientific-publication':'assessment-dossier'}))),note:'Counts distinguish flattened source rows from unique documents. Select a section, then an exact recordId for available fields. A REF_SUB record is chemical identity, not a toxicological reference value; reference values are in FLEX_SUM.ToxRefValues. Related records retain source-declared citation, dossier and registry links.'};
    let found:SourceRow[],total:number;
    if(args.recordId){
      const [sheet,row]=args.recordId.split(':');
      found=(db.prepare('SELECT * FROM records WHERE sheet=? AND source_row=?').all(sheet,Number(row)) as SourceRow[]).filter(row=>row.parent_id===args.substanceId||(row.document_id!==null&&relatedIds.has(row.document_id)));
      total=found.length;
    }else{
      const sheets=openFoodToxSections[args.section as keyof typeof openFoodToxSections];
      if(!sheets)throw new Error('section');
      const placeholders=sheets.map(()=>'?').join(',');
      total=(db.prepare(`SELECT COUNT(*) AS count FROM records WHERE parent_id=? AND sheet IN (${placeholders})`).get(args.substanceId,...sheets) as {count:number}).count;
      found=db.prepare(`SELECT * FROM records WHERE parent_id=? AND sheet IN (${placeholders}) ORDER BY sheet,source_row LIMIT ? OFFSET ?`).all(args.substanceId,...sheets,args.limit,args.offset) as SourceRow[];
    }
    const results:OpenFoodToxRecord[]=found.map(row=>{
      const headers=JSON.parse((db.prepare('SELECT headers_json FROM sheets WHERE name=?').get(row.sheet) as {headers_json:string}).headers_json) as Array<string|null>;
      const pairs=JSON.parse(row.cells_json) as Array<[number,string|number|boolean]>;
      const fields:OpenFoodToxRecord['fields']={},truncatedFields:string[]=[],availableFields=pairs.filter(([column])=>!!headers[column]).map(([column])=>headers[column]!);
      let remaining=args.fields?12000:args.recordId?10000:3500;
      for(const [column,value] of pairs){
        const key=headers[column];if(!key||['Document UUID','Parent UUID'].includes(key)||(args.fields&&!args.fields.includes(key)))continue;
        const maxLength=Math.min(remaining,args.fields?8000:args.recordId?2500:800);
        if(typeof value==='string'&&(value.length>maxLength||maxLength<=0)){truncatedFields.push(key);}
        else if(remaining>0){fields[key]=value;remaining-=String(value).length;}else truncatedFields.push(key);
      }
      const links=(db.prepare('SELECT field,target_id,target_type FROM links WHERE sheet=? AND source_row=? ORDER BY field,target_id').all(row.sheet,row.source_row) as Array<{field:string;target_id:string;target_type:string}>).slice(0,12).map(link=>({field:link.field,targetId:link.target_id,targetType:link.target_type,records:(db.prepare('SELECT sheet,source_row FROM records WHERE document_id=? ORDER BY sheet,source_row LIMIT 5').all(link.target_id) as Array<{sheet:string;source_row:number}>).map(record=>`${record.sheet}:${record.source_row}`)}));
      const missingFields=(args.fields??[]).filter(field=>!availableFields.includes(field));
      return{recordId:`${row.sheet}:${row.source_row}`,documentId:row.document_id,parentId:row.parent_id,section:row.sheet,endpoint:row.endpoint,fields,availableFields,truncatedFields,missingFields,selectedFieldsComplete:truncatedFields.length===0&&missingFields.length===0,links,otherRowsForDocument:row.document_id?(db.prepare('SELECT COUNT(*)-1 AS count FROM records WHERE sheet=? AND document_id=?').get(row.sheet,row.document_id) as {count:number}).count:0};
    });
    return{status:results.length?'ok' as const:'no_match' as const,source,substanceId:args.substanceId,coverage:counts,totalRows:total,offset:args.offset,nextOffset:!args.recordId&&args.offset+found.length<total?args.offset+found.length:null,results,
      limitations:'Source rows are flattened records, not independent studies. HumanHealth and AnimalHealth are source hazard/assessment domains, not a declaration that study subjects were human or animal. Read species/population and endpoint fields. A hazard endpoint or reference value is not package exposure, Indian permission, a personal target or a safety verdict. Fields listed in truncatedFields are omitted in full, not clipped into apparent evidence. Request the exact recordId and fields before interpreting their missing context, or consult the original EFSA output.'};
  }catch{return{status:'unavailable' as const,reason:'invalid-store',results:[]};}finally{db.close();}
}
