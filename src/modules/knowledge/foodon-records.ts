import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

type SourceNode={predicate:string;attributes:Record<string,string>;text:string|null;tail:string|null;children:SourceNode[]};
function sourceNode(value:unknown):value is SourceNode {
  const pending=[{value,depth:0}];let count=0;
  while(pending.length){const {value:node,depth}=pending.pop()!;if(++count>1000||depth>30||!node||typeof node!=='object')return false;const n=node as SourceNode;
    if(typeof n.predicate!=='string'||!(n.text===null||typeof n.text==='string')||!(n.tail===null||typeof n.tail==='string')||!n.attributes||typeof n.attributes!=='object'||Array.isArray(n.attributes)||!Object.values(n.attributes).every(v=>typeof v==='string')||!Array.isArray(n.children))return false;
    pending.push(...n.children.map(value=>({value,depth:depth+1})));
  }return true;
}

/** Original source properties, not inferred OWL entailments or clinical evidence. */
export function readFoodOnSourceRecord<T extends {ontologySha256:string}>(args:{id:string;offset:number;limit:number},source:T,fallback?:{id:string;label:string}) {
  let db:DatabaseSync|undefined;
  try{
    db=new DatabaseSync(process.env.NUTRISCAN_FOODON_RECORDS_DATABASE??path.join(process.cwd(),'.data/knowledge/foodon-records.sqlite'),{readOnly:true});
    const metadata=Object.fromEntries((db.prepare('SELECT key,value FROM metadata').all()as{key:string;value:string}[]).map(r=>[r.key,r.value]));
    if(metadata.schemaVersion!=='1'||metadata.sourceHash!==source.ontologySha256)throw Error('Source mismatch');
    const counts=JSON.parse(metadata.counts)as{classes:number;fields:number};
    if((db.prepare('SELECT count(*) AS n FROM concepts').get()as{n:number}).n!==counts.classes||(db.prepare('SELECT count(*) AS n FROM fields').get()as{n:number}).n!==counts.fields)throw Error('Incomplete source store');
    const record=db.prepare('SELECT label,deprecated,xml,xml_hash FROM concepts WHERE id=?').get(args.id)as{label:string|null;deprecated:number|null;xml:string;xml_hash:string}|undefined;
    if(record&&createHash('sha256').update(record.xml).digest('hex')!==record.xml_hash)throw Error('Source class changed');
    const total=(db.prepare('SELECT count(*) AS n FROM fields WHERE concept_id=?').get(args.id)as{n:number}).n;
    if(!record&&!total&&!fallback)return{status:'no_match' as const,source,results:[]};
    const concept={id:args.id,label:record?.label??fallback?.label??args.id};
    const sourcePresence=record?'owl-class-declaration':total?'axiom-annotation-only':'synonym-export-only';
    const selected=db.prepare('SELECT ordinal,kind,predicate,payload_hash,length(CAST(payload AS BLOB)) AS bytes,CASE WHEN length(CAST(payload AS BLOB))<=12000 THEN payload ELSE NULL END AS payload FROM fields WHERE concept_id=? AND ordinal>=? ORDER BY ordinal LIMIT ?').all(args.id,args.offset,args.limit)as{ordinal:number;kind:string;predicate:string;payload:string|null;payload_hash:string;bytes:number}[];
    const results:{ordinal:number;kind:string;predicate:string;value:SourceNode;sha256:string}[]=[],corruptFields:number[]=[],oversizedFields:number[]=[];let bytes=0,next=args.offset;
    for(const field of selected){if(results.length&&bytes+field.bytes>12000)break;next=field.ordinal+1;
      if(field.payload===null){oversizedFields.push(field.ordinal);continue;}
      if(createHash('sha256').update(field.payload).digest('hex')!==field.payload_hash){corruptFields.push(field.ordinal);continue;}
      const value:unknown=JSON.parse(field.payload);if(!sourceNode(value)){corruptFields.push(field.ordinal);continue;}
      results.push({ordinal:field.ordinal,kind:field.kind,predicate:field.predicate,value,sha256:field.payload_hash});bytes+=field.bytes;
    }
    return{status:'ok' as const,source,concept,relation:'source' as const,sourcePresence,deprecated:record?.deprecated===null||!record?null:record.deprecated===1,total,offset:args.offset,nextOffset:next<total?next:null,results,corruptFields,oversizedFields,
      limitations:'Original named-class properties and annotated-source axioms from the pinned OWL, not a reasoned ontology. Text, language, datatype, resources and nested restrictions remain separate. A synonym-export-only ID has no declared class here; its current status is unknown. Imported ontology expansion, clinical effects, package composition, allergy/cross-contact and legal permission are not established by these records.'};
  }catch{return{status:'unavailable' as const,reason:'missing-or-invalid-source-record-store',results:[]};}finally{db?.close();}
}
