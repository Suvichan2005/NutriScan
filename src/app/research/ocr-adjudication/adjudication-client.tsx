'use client';

import { useEffect, useMemo, useState } from 'react';
import { ocrAdjudicationInputSchema, ocrAdjudicationDispositionSchema, ocrAnnotationPassSchema, ocrAnnotatedDatasetSchema, ocrDatasetFieldSchema, type OcrAnnotationPass, type OcrDatasetField } from '@/lib/contracts';
import { adjudicateOcrAnnotationPasses } from '@/lib/ocr-annotation';
import styles from './adjudication.module.css';

type Reader = { name:string; sha256:string; pass:OcrAnnotationPass };
type LocalImage = { url:string; sha256:string; width:number; height:number; byteLength:number };
type OcrAdjudicationDisposition = typeof ocrAdjudicationDispositionSchema.options[number];
type DecisionDraft = { fieldId:string; readerAFieldId:string; readerBFieldId:string; disposition:OcrAdjudicationDisposition; regionSource:'reader-a'|'reader-b'; rationale:string; manualJson:string };
const maxImageBytes=25*1024*1024;
const maxPassBytes=5*1024*1024;
const colors={a:'#236b9b',b:'#a34a31'};
const hashHex=(buffer:ArrayBuffer)=>Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,'0')).join('');
const fieldSummary=(field:OcrDatasetField)=>`${field.printedNumericText??'no printed digits'} · ${field.numericValue??'unresolved'} ${field.unit??'unit unknown'} · ${field.basisText??field.basis?.kind??'basis unknown'} · ${field.status}`;
const freshDecision=(index:number):DecisionDraft=>({fieldId:`adjudicated-${index}`,readerAFieldId:'',readerBFieldId:'',disposition:'reader-a',regionSource:'reader-a',rationale:'',manualJson:''});

export default function AdjudicationClient(){
  const [readerA,setReaderA]=useState<Reader|null>(null);
  const [readerB,setReaderB]=useState<Reader|null>(null);
  const [image,setImage]=useState<LocalImage|null>(null);
  const [datasetVersion,setDatasetVersion]=useState('packaged-foods-v1');
  const [adjudicatorCode,setAdjudicatorCode]=useState('');
  const [method,setMethod]=useState('Two independent single-reader passes reviewed against the original package photograph; explicit field mapping and rationale recorded for each reference field.');
  const [decisions,setDecisions]=useState<DecisionDraft[]>([]);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [output,setOutput]=useState('');
  const [busy,setBusy]=useState(false);

  useEffect(()=>()=>{if(image?.url)URL.revokeObjectURL(image.url);},[image?.url]);
  const passA=readerA?.pass.record;
  const passB=readerB?.pass.record;
  const targetMatches=useMemo(()=>!!(passA&&passB&&image&&passA.image.sha256.toLowerCase()===passB.image.sha256.toLowerCase()&&passA.image.width===passB.image.width&&passA.image.height===passB.image.height&&passA.image.byteLength===passB.image.byteLength&&passA.image.sha256.toLowerCase()===image.sha256&&passA.image.width===image.width&&passA.image.height===image.height&&passA.image.byteLength===image.byteLength),[passA,passB,image]);

  async function loadPass(side:'reader-a'|'reader-b',file?:File){
    setError('');setNotice('');setOutput('');
    if(!file)return;
    if(file.size>maxPassBytes){setError('Annotation JSON must be 5 MB or smaller.');return;}
    try{
      const bytes=await file.arrayBuffer();
      const raw=JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      const pass=ocrAnnotationPassSchema.parse(raw);
      const next={name:file.name,sha256:hashHex(await crypto.subtle.digest('SHA-256',bytes)),pass};
      if(side==='reader-a')setReaderA(next);else setReaderB(next);
      setDecisions([]);
      setNotice(`${side==='reader-a'?'Reader A':'Reader B'} pass validated locally. The original JSON bytes are hashed for lineage.`);
    }catch(e){setError(e instanceof Error?`Could not load ${side}: ${e.message}`:`Could not read ${side} annotation pass.`);}
  }

  async function loadImage(file?:File){
    setError('');setNotice('');setOutput('');
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setError('Choose a JPEG, PNG or WebP package photograph.');return;}
    if(file.size>maxImageBytes){setError('This local review tool accepts images up to 25 MB.');return;}
    setBusy(true);
    try{
      if(!crypto.subtle)throw new Error('SHA-256 is unavailable; open the local app on localhost or HTTPS.');
      const bitmap=await createImageBitmap(file);const {width,height}=bitmap;bitmap.close();
      if(width*height>40_000_000)throw new Error('The image exceeds the 40-megapixel local safety limit.');
      const bytes=await file.arrayBuffer();
      const next={url:URL.createObjectURL(file),sha256:hashHex(await crypto.subtle.digest('SHA-256',bytes)),width,height,byteLength:file.size};
      setImage(next);setDecisions([]);setNotice('Package photo loaded in this tab. Image bytes are not uploaded or included in the adjudicated dataset.');
    }catch(e){setError(e instanceof Error?e.message:'The image could not be decoded or hashed locally.');}
    finally{setBusy(false);}
  }

  function updateDecision(index:number,patch:Partial<DecisionDraft>){setDecisions(previous=>previous.map((decision,i)=>i===index?{...decision,...patch}:decision));setOutput('');}
  function addDecision(){setDecisions(previous=>[...previous,freshDecision(previous.length+1)]);setError('');setOutput('');}
  function selectedSource(decision:DecisionDraft){return decision.regionSource==='reader-a'?passA?.annotations.nutrients.find(field=>field.fieldId===decision.readerAFieldId)??null:passB?.annotations.nutrients.find(field=>field.fieldId===decision.readerBFieldId)??null;}
  function makeWithheldField(decision:DecisionDraft,status:'ambiguous'|'not-visible'):OcrDatasetField|null{
    const source=selectedSource(decision);if(!source)return null;
    return {...source,fieldId:decision.fieldId,key:source.key,labelText:source.labelText,printedNumericText:null,numericValue:null,numericOperator:null,unit:null,basis:null,basisText:null,status};
  }
  function decisionPayload(decision:DecisionDraft){
    const readerAFieldId=decision.readerAFieldId||null,readerBFieldId=decision.readerBFieldId||null;
    let field:OcrDatasetField|null=null;
    if(decision.disposition==='manual'){
      const raw=JSON.parse(decision.manualJson||'null') as unknown;
      field=ocrDatasetFieldSchema.parse(raw);
    }else if(decision.disposition==='ambiguous'||decision.disposition==='not-visible'){
      field=makeWithheldField(decision,decision.disposition);
    }
    const regionSource=decision.disposition==='reader-a'?'reader-a':decision.disposition==='reader-b'?'reader-b':decision.regionSource;
    return {fieldId:decision.fieldId,disposition:decision.disposition,readerAFieldId,readerBFieldId,field,regionSource,rationale:decision.rationale};
  }

  function exportDataset(){
    setError('');setNotice('');setOutput('');
    if(!readerA||!readerB||!image){setError('Load both independent passes and the exact original photo first.');return;}
    if(!targetMatches){setError('The two passes and selected image must match by SHA-256, dimensions and byte length.');return;}
    if(!decisions.length){setError('Add explicit field decisions; array-order pairing is never inferred.');return;}
    try{
      const input=ocrAdjudicationInputSchema.parse({schemaVersion:1,datasetVersion,adjudicatorCode,adjudicatedAt:new Date().toISOString(),method,decisions:decisions.map(decisionPayload)});
      const record=adjudicateOcrAnnotationPasses(readerA.pass,readerB.pass,input,{readerA:readerA.sha256,readerB:readerB.sha256});
      const dataset=ocrAnnotatedDatasetSchema.parse({schemaVersion:2,datasetVersion:input.datasetVersion,records:[record]});
      const json=JSON.stringify(dataset,null,2);setOutput(json);
      const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=`${record.imageId.replace(/[^a-zA-Z0-9._-]/g,'_')}-adjudicated-dataset.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setNotice('Validated one-record dataset exported. It contains pass hashes and decision lineage, but no image bytes, source filenames or local paths.');
    }catch(e){setError(e instanceof Error?e.message:'The decisions did not produce a valid adjudicated record.');}
  }

  const tableRegions=[...(passA?.annotations.tableRegions.map(region=>({region,reader:'A' as const}))??[]),...(passB?.annotations.tableRegions.map(region=>({region,reader:'B' as const}))??[])];
  return <main className={styles.page}><div className={styles.wrap}>
    <header className={styles.masthead}><a className={styles.brand} href="/">nutriscan.</a><span className={styles.local}>Local adjudication · no upload</span></header>
    <section className={styles.intro}><h1>Review two independent label reads</h1><p>Load both completed annotation passes and the exact package photograph. Map each reader field explicitly, preserve uncertainty, and export a traceable reference record. The decisions run in this browser tab only.</p></section>
    <div className={styles.callout}><strong>Keep adjudication auditable.</strong> Only open these files after both readers finish independently. Compare the source photograph, never pair by row order automatically, and keep unreadable or disputed digits, units and bases null. Exported records contain source-image hashes and references, not photographs or local filenames.</div>
    <section className={styles.card}><h2>1. Load both passes and verify the original image</h2><p className={styles.sub}>Pass JSON and photo bytes stay in browser memory. SHA-256, dimensions and byte length must match all three files before decisions can be exported.</p><div className={styles.form}>
      <div className={styles.grid2}>
        <label className={styles.control}>Reader A annotation JSON<input type="file" accept="application/json,.json" onChange={event=>{void loadPass('reader-a',event.currentTarget.files?.[0]);event.currentTarget.value='';}}/><span className={styles.help}>Pseudonymous reader code and image fingerprint are shown after validation.</span></label>
        <label className={styles.control}>Reader B annotation JSON<input type="file" accept="application/json,.json" onChange={event=>{void loadPass('reader-b',event.currentTarget.files?.[0]);event.currentTarget.value='';}}/><span className={styles.help}>Must be a distinct, independently prepared pass.</span></label>
      </div>
      <label className={styles.control}>Original package photograph<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>{void loadImage(event.currentTarget.files?.[0]);event.currentTarget.value='';}} disabled={busy}/><span className={styles.help}>JPEG, PNG or WebP · up to 25 MB / 40 megapixels · processed locally</span></label>
      {readerA&&readerB&&<div className={styles.readerGrid}>
        {[{reader:readerA,side:'Reader A'},{reader:readerB,side:'Reader B'}].map(({reader,side})=><div className={styles.reader} key={side}><h3>{side}: {reader.pass.annotatorCode}</h3><p>Pass SHA-256: {reader.sha256}</p><p>Image {reader.pass.record.imageId} · {reader.pass.record.image.width} × {reader.pass.record.image.height} · {reader.pass.record.image.byteLength.toLocaleString()} bytes</p><div className={styles.fieldList}>{reader.pass.record.annotations.nutrients.map(field=><div className={styles.field} key={field.fieldId}><strong>{field.fieldId} · {field.labelText}</strong>{fieldSummary(field)}</div>)}</div></div>)}
      </div>}
      {image&&<><div className={styles.preview} data-testid="adjudication-image"><div className={styles.previewImage}><img src={image.url} alt="Original package photograph for human adjudication"/><svg className={styles.overlay} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">{tableRegions.map(({region,reader},index)=><polygon key={`${reader}-${region.regionId}-${index}`} points={region.polygon.map(point=>`${point[0]},${point[1]}`).join(' ')} fill={reader==='A'?'#236b9b20':'#a34a3120'} stroke={colors[reader==='A'?'a':'b']} strokeDasharray={reader==='A'?'none':'.012 .006'} strokeWidth=".003"><title>Reader {reader} · {region.role} · {region.regionId}</title></polygon>)}</svg></div></div><div className={styles.meta}><span>{image.width} × {image.height}px</span><span>{image.byteLength.toLocaleString()} bytes</span><code>SHA-256 {image.sha256}</code></div></>}
      {readerA&&readerB&&image&&<p className={targetMatches?styles.ok:styles.error} role={targetMatches?'status':'alert'}>{targetMatches?'All image fingerprints match.':'Image fingerprint mismatch: do not export until the correct original image and two matching passes are loaded.'}</p>}
    </div></section>
    <section className={styles.card}><h2>2. Record explicit field decisions</h2><p className={styles.sub}>Every source field from both passes must be linked exactly once. A decision may use Reader A, Reader B, an explicitly transcribed field, ambiguous, or not visible. Region links are retained from the chosen pass and remapped in the output.</p>
      <div className={styles.form}><div className={styles.grid2}><label className={styles.control}>Dataset version<input value={datasetVersion} maxLength={80} onChange={event=>setDatasetVersion(event.target.value)}/></label><label className={styles.control}>Adjudicator code<input value={adjudicatorCode} maxLength={80} onChange={event=>setAdjudicatorCode(event.target.value)} placeholder="Anonymous code"/></label></div><label className={styles.control}>Adjudication method<input value={method} maxLength={1000} onChange={event=>setMethod(event.target.value)}/></label>
      <div className={styles.decisionList}>{decisions.map((decision,index)=><div className={styles.decision} data-testid="adjudication-decision" key={`${index}-${decision.fieldId}`}>
        <div className={styles.decisionHead}><strong>Decision {index+1}</strong><button type="button" className={styles.secondary} onClick={()=>setDecisions(previous=>previous.filter((_,i)=>i!==index))}>Remove</button></div>
        <div className={styles.decisionGrid}><label className={styles.control}>Final field ID<input value={decision.fieldId} maxLength={120} onChange={event=>updateDecision(index,{fieldId:event.target.value})}/></label><label className={styles.control}>Decision<select value={decision.disposition} onChange={event=>updateDecision(index,{disposition:event.target.value as OcrAdjudicationDisposition})}><option value="reader-a">Use Reader A</option><option value="reader-b">Use Reader B</option><option value="manual">Manual visual transcription</option><option value="ambiguous">Retain as ambiguous</option><option value="not-visible">Not visible on image</option></select></label>
          <label className={styles.control}>Reader A source field<select value={decision.readerAFieldId} onChange={event=>updateDecision(index,{readerAFieldId:event.target.value})}><option value="">Select a Reader A field</option>{(passA?.annotations.nutrients??[]).map(field=><option value={field.fieldId} key={field.fieldId}>{field.fieldId} · {field.labelText} · {field.printedNumericText??'unreadable'}</option>)}</select></label>
          <label className={styles.control}>Reader B source field<select value={decision.readerBFieldId} onChange={event=>updateDecision(index,{readerBFieldId:event.target.value})}><option value="">Select a Reader B field</option>{(passB?.annotations.nutrients??[]).map(field=><option value={field.fieldId} key={field.fieldId}>{field.fieldId} · {field.labelText} · {field.printedNumericText??'unreadable'}</option>)}</select></label>
        </div>
        {(decision.disposition==='manual'||decision.disposition==='ambiguous'||decision.disposition==='not-visible')&&<>
          <label className={styles.control}>Region source<select value={decision.regionSource} onChange={event=>updateDecision(index,{regionSource:event.target.value as DecisionDraft['regionSource']})}><option value="reader-a">Reader A regions</option><option value="reader-b">Reader B regions</option></select></label>
          {decision.disposition==='manual'?<div className={styles.form}><button type="button" className={styles.secondary} onClick={()=>{const source=selectedSource(decision);if(!source){setError('Select a source field from the chosen region reader first.');return;}updateDecision(index,{manualJson:JSON.stringify({...source,fieldId:decision.fieldId},null,2)});}}>Use selected pass field as template</button><label className={styles.control}>Final field JSON<textarea value={decision.manualJson} onChange={event=>updateDecision(index,{manualJson:event.target.value})} placeholder={'Use the template button, then edit the visible values. The fieldId must match the decision ID.'}/><span className={styles.help}>Use the shared nutrient field shape. A clear manual field requires a readable value and basis; region IDs must come from the selected reader.</span></label></div>:<p className={styles.help}>Choose a source field from the selected region reader. The source supplies the field label and region links. Numeric text, numeric value, operator, unit, basis and basis text are set to null; nothing uncertain becomes a reference value.</p>}
        </>}
        <label className={styles.control}>Why this decision? (required)<textarea value={decision.rationale} maxLength={1000} onChange={event=>updateDecision(index,{rationale:event.target.value})} placeholder="Describe what the source image supports and what remains uncertain."/></label>
      </div>)}</div>
      <div className={styles.actions}><button className={styles.secondary} type="button" onClick={addDecision}>Add field decision</button><button className={styles.primary} type="button" onClick={exportDataset} disabled={!targetMatches}>Validate and export dataset</button></div>
      {error&&<p className={styles.error} role="alert">{error}</p>}{notice&&<p className={styles.ok} role="status">{notice}</p>}{output&&<pre className={styles.output} aria-label="Validated adjudicated dataset preview">{output}</pre>}
      </div>
    </section>
    <footer className={styles.footer}>Local-only tool. Independent reads and explicit adjudication are required before a record can be marked human-verified. The resulting agreement score describes reader agreement, not OCR accuracy or population performance. <a className={styles.brand} href="/research/ocr-annotation">Return to the independent annotation form</a></footer>
  </div></main>;
}
