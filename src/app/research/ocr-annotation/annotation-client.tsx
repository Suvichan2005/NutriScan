'use client';

import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ocrAnnotationPassSchema, ocrAnnotatedRegionSchema, ocrDatasetFieldSchema, type OcrAnnotatedRegion, type OcrDatasetField, type OcrBasis } from '@/lib/contracts';
import styles from './annotation.module.css';

type AnnotationSource = {
  url:string; imageUrl:string; publisher:string; uploader:string; licenseId:string;
  licenseUrl:string; retrievedAt:string; redistributionReview:'pending'|'approved'|'not-approved'|'unknown'
};
export type AnnotationCandidate = {
  imageId:string; productGroupId:string; productName:string; sha256:string;
  width:number; height:number; byteLength:number; source:AnnotationSource
};
type LocalImage = { url:string; width:number; height:number; byteLength:number; sha256:string };
type Draft = {
  key:string; labelText:string; printedNumericText:string; numericValue:string; numericOperator:'eq'|'lt'|'lte'|'gt'|'gte';
  unit:string; basisKind:OcrBasis['kind']; basisAmount:string; basisUnit:'g'|'ml'|'piece'; basisText:string;
  columnId:string; status:OcrDatasetField['status']; labelRegionId:string; valueRegionId:string;
  rowRegionId:string; unitRegionId:string; basisRegionId:string
};
const maxImageBytes=25*1024*1024;
const maxPixels=40_000_000;
const emptySource=():AnnotationSource=>({url:'',imageUrl:'',publisher:'',uploader:'',licenseId:'',licenseUrl:'',retrievedAt:new Date().toISOString().slice(0,10),redistributionReview:'unknown'});
const freshDraft=():Draft=>({key:'energy',labelText:'',printedNumericText:'',numericValue:'',numericOperator:'eq',unit:'',basisKind:'unknown',basisAmount:'',basisUnit:'g',basisText:'',columnId:'',status:'clear',labelRegionId:'',valueRegionId:'',rowRegionId:'',unitRegionId:'',basisRegionId:''});
const roleColors:Record<OcrAnnotatedRegion['role'],string>={table:'#276c43',row:'#5f4f9e',label:'#1c5a92',value:'#8d452b',unit:'#7c5b10',basis:'#0c6670','other-text':'#4f5952'};

function hashHex(buffer:ArrayBuffer):string {
  return Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function basisForDraft(draft:Draft):OcrBasis|null {
  if (draft.basisKind==='unknown') return {kind:'unknown',amount:null,unit:null};
  if (draft.basisKind==='per-100g') return {kind:'per-100g',amount:100,unit:'g'};
  if (draft.basisKind==='per-100ml') return {kind:'per-100ml',amount:100,unit:'ml'};
  if (draft.basisKind==='per-unit') return {kind:'per-unit',amount:Number(draft.basisAmount||1),unit:draft.basisAmount?draft.basisUnit:'piece'};
  const amount=draft.basisAmount.trim()?Number(draft.basisAmount):null;
  const unit=amount===null?null:draft.basisUnit;
  return {kind:draft.basisKind,amount,unit};
}
function makePolygon(x0:number,y0:number,x1:number,y1:number):OcrAnnotatedRegion['polygon'] {
  const left=Math.min(x0,x1),right=Math.max(x0,x1),top=Math.min(y0,y1),bottom=Math.max(y0,y1);
  return [[left,top],[right,top],[right,bottom],[left,bottom]];
}

export default function AnnotationClient({candidates}:{candidates:AnnotationCandidate[]}) {
  const [annotatorCode,setAnnotatorCode]=useState('');
  const [candidateId,setCandidateId]=useState('custom');
  const candidate=useMemo(()=>candidates.find(item=>item.imageId===candidateId),[candidates,candidateId]);
  const [image,setImage]=useState<LocalImage|null>(null);
  const [imageId,setImageId]=useState('');
  const [productGroupId,setProductGroupId]=useState('');
  const [split,setSplit]=useState<'development'|'held-out'|'not-assigned'>('not-assigned');
  const [language,setLanguage]=useState('en');
  const [source,setSource]=useState<AnnotationSource>(emptySource);
  const [regionRole,setRegionRole]=useState<OcrAnnotatedRegion['role']>('table');
  const [regionColumn,setRegionColumn]=useState('');
  const [regions,setRegions]=useState<OcrAnnotatedRegion[]>([]);
  const [drawing,setDrawing]=useState<{x:number;y:number;nowX:number;nowY:number}|null>(null);
  const [draft,setDraft]=useState<Draft>(freshDraft);
  const [fields,setFields]=useState<OcrDatasetField[]>([]);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);

  useEffect(()=>()=>{if(image?.url)URL.revokeObjectURL(image.url);},[image?.url]);
  useEffect(()=>{
    if(candidate){
      setImageId(candidate.imageId);setProductGroupId(candidate.productGroupId);setSource({...candidate.source});setSplit('not-assigned');
    } else if(candidateId==='custom') {
      setSource(emptySource());
      setImageId('');setProductGroupId('');setSplit('not-assigned');
    }
  },[candidate]);

  const currentRegionIds=useMemo(()=>new Set(regions.map(region=>region.regionId)),[regions]);
  const matchesCandidate=!candidate||!image||candidate.sha256===image.sha256;
  const regionSelect=(label:string,key:keyof Draft,role:OcrAnnotatedRegion['role'])=> <label className={styles.control}>{label}<select value={draft[key] as string} onChange={event=>setDraft(previous=>({...previous,[key]:event.target.value}))}><option value="">Not linked</option>{regions.filter(region=>region.role===role).map(region=><option value={region.regionId} key={region.regionId}>{region.regionId}{region.columnId?` · ${region.columnId}`:''}</option>)}</select></label>;

  async function handleFile(file:File|undefined) {
    setError('');setNotice('');setRegions([]);setFields([]);
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setError('Choose a JPEG, PNG or WebP image.');return;}
    if(file.size>maxImageBytes){setError('This local annotation tool accepts images up to 25 MB.');return;}
    if(!globalThis.crypto?.subtle){setError('SHA-256 is unavailable in this browser context. Open the app on localhost or HTTPS and try again.');return;}
    setBusy(true);
    try {
      const url=URL.createObjectURL(file);
      const bitmap=await createImageBitmap(file);
      const {width,height}=bitmap;bitmap.close();
      if(width*height>maxPixels){URL.revokeObjectURL(url);setError('This image exceeds the 40-megapixel local safety limit.');return;}
      const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
      const next={url,width,height,byteLength:file.size,sha256:hashHex(digest)};
      setImage(next);
      const match=candidates.find(item=>item.sha256===next.sha256);
      if(match)setCandidateId(match.imageId);
      else {
        setCandidateId('custom');setImageId('');setProductGroupId('');setSource(emptySource());setSplit('not-assigned');
      }
      setNotice(match?`Image hash matches the registered ${match.productName} candidate.`:'Image loaded locally. No registered candidate matched its SHA-256; enter and review source provenance below.');
    } catch {
      setError('The image could not be decoded or hashed in this browser. The file was not uploaded.');
    } finally {setBusy(false);}
  }

  function point(event:ReactPointerEvent<SVGSVGElement>) {
    const rect=event.currentTarget.getBoundingClientRect();
    return {x:Math.min(1,Math.max(0,(event.clientX-rect.left)/rect.width)),y:Math.min(1,Math.max(0,(event.clientY-rect.top)/rect.height))};
  }
  function beginDraw(event:ReactPointerEvent<SVGSVGElement>) {
    if(!image)return;
    event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
    const p=point(event);setDrawing({x:p.x,y:p.y,nowX:p.x,nowY:p.y});
  }
  function continueDraw(event:ReactPointerEvent<SVGSVGElement>) {
    if(!drawing)return;const p=point(event);setDrawing(previous=>previous?{...previous,nowX:p.x,nowY:p.y}:null);
  }
  function finishDraw(event:ReactPointerEvent<SVGSVGElement>) {
    if(!drawing)return;const p=point(event);const polygon=makePolygon(drawing.x,drawing.y,p.x,p.y);
    const width=Math.abs(p.x-drawing.x),height=Math.abs(p.y-drawing.y);
    setDrawing(null);
    if(width<.003||height<.003)return;
    const nextRegionNumber=regions.reduce((maximum,region)=>Math.max(maximum,Number(region.regionId.match(/^r(\d+)$/)?.[1]??0)),0)+1;
    const proposed={regionId:`r${nextRegionNumber}`,role:regionRole,columnId:regionColumn.trim()||null,polygon};
    const parsed=ocrAnnotatedRegionSchema.safeParse(proposed);
    if(!parsed.success){setError('The selected rectangle did not form a valid region. Draw it again.');return;}
    setRegions(previous=>[...previous,parsed.data]);setError('');
  }
  function deleteRegion(regionId:string) {
    setRegions(previous=>previous.filter(region=>region.regionId!==regionId));
    setFields(previous=>previous.map(field=>({...field,labelRegionId:field.labelRegionId===regionId?null:field.labelRegionId,valueRegionId:field.valueRegionId===regionId?null:field.valueRegionId,rowRegionId:field.rowRegionId===regionId?null:field.rowRegionId,unitRegionId:field.unitRegionId===regionId?null:field.unitRegionId,basisRegionId:field.basisRegionId===regionId?null:field.basisRegionId})));
  }
  function addField() {
    setError('');
    const amount=draft.numericValue.trim()?Number(draft.numericValue):null;
    if(draft.numericValue.trim()&&(!Number.isFinite(amount)||amount!<0)){setError('Enter a non-negative numeric interpretation using a period for decimals, or leave it blank when unreadable.');return;}
    if(draft.status==='clear'&&(amount===null||draft.basisKind==='unknown')){setError('A clear field needs a readable numeric value and known serving basis. Leave the unit blank when none is printed; mark the field ambiguous when its value or basis cannot be read.');return;}
    if(draft.printedNumericText.trim()&&!draft.printedNumericText.trim().match(/^[0-9]+(?:[.,][0-9]+)?$/)){setError('Enter only the literal digits and decimal separator in the printed-value field; put < or > in the qualifier selector.');return;}
    const nextFieldNumber=fields.reduce((maximum,field)=>Math.max(maximum,Number(field.fieldId.match(/^field-(\d+)$/)?.[1]??0)),0)+1;
    const fieldId=`field-${nextFieldNumber}`;
    const proposed={
      fieldId,key:draft.key.trim(),labelText:draft.labelText.trim(),printedNumericText:draft.printedNumericText.trim()||null,
      numericValue:amount,numericOperator:draft.numericOperator,unit:draft.unit.trim()||null,basis:basisForDraft(draft),basisText:draft.basisText.trim()||null,
      labelRegionId:draft.labelRegionId||null,valueRegionId:draft.valueRegionId||null,rowRegionId:draft.rowRegionId||null,
      unitRegionId:draft.unitRegionId||null,basisRegionId:draft.basisRegionId||null,columnId:draft.columnId.trim()||null,status:draft.status
    };
    const parsed=ocrDatasetFieldSchema.safeParse(proposed);
    if(!parsed.success){setError(parsed.error.issues[0]?.message??'This nutrient annotation does not match the shared contract.');return;}
    const linkedIds=[parsed.data.labelRegionId,parsed.data.valueRegionId,parsed.data.rowRegionId,parsed.data.unitRegionId,parsed.data.basisRegionId].filter(Boolean) as string[];
    if(linkedIds.some(id=>!currentRegionIds.has(id))){setError('One linked region was removed. Select an existing region or clear that link.');return;}
    setFields(previous=>[...previous,parsed.data]);setDraft(freshDraft());setNotice('Nutrient row added. A missing or unreadable value remains null, never zero.');
  }
  function removeField(fieldId:string) {setFields(previous=>previous.filter(field=>field.fieldId!==fieldId));}

  async function exportPass() {
    setError('');setNotice('');
    if(!image){setError('Choose a package-label photograph first.');return;}
    if(!regions.some(region=>region.role==='table')){setError('Mark the nutrition table region before exporting this pass.');return;}
    if(fields.length===0){setError('Transcribe at least one visible nutrient row. Record unreadable rows as ambiguous; do not leave them out or enter zero.');return;}
    const geometryIncomplete=fields.some(field=>field.status==='clear'&&(!field.labelRegionId||!field.valueRegionId||!field.rowRegionId||(field.unit&&!field.unitRegionId)||!field.basisRegionId||!field.columnId||!field.basisText));
    if(geometryIncomplete){setError('Each clear nutrient row needs label, value, row and basis regions plus its column and exact basis text. Link a unit region when a printed unit is present. Mark uncertain rows ambiguous instead.');return;}
    if(!matchesCandidate){setError('The chosen photo SHA-256 does not match the registered source image. Select the correct photo or choose Custom / other source.');return;}
    const effectiveSource=source;
    const record={
      imageId,productGroupId,split,
      image:{sha256:image.sha256,width:image.width,height:image.height,byteLength:image.byteLength},
      source:effectiveSource,
      annotations:{language,tableRegions:regions,nutrients:fields,review:{annotatorCount:1,adjudicated:false,agreementMetric:null,referenceStatus:'single-reader' as const,method:'Independent human transcription from the original package photograph. No OCR output, product database, nutrient arithmetic, or other annotator pass was displayed.'}}
    };
    const parsed=ocrAnnotationPassSchema.safeParse({schemaVersion:1,annotatorCode,createdAt:new Date().toISOString(),record});
    if(!parsed.success){setError(parsed.error.issues.slice(0,3).map(issue=>`${issue.path.join('.')||'pass'}: ${issue.message}`).join(' · '));return;}
    const blob=new Blob([JSON.stringify(parsed.data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=`${imageId.replace(/[^a-zA-Z0-9._-]/g,'_')}-${annotatorCode.replace(/[^a-zA-Z0-9._-]/g,'_')}-annotation-pass.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    setNotice('Independent annotation pass exported. It contains SHA-256, dimensions and labels only; the photo bytes were not included. Keep this pass private until both annotators finish.');
  }

  const drawingRect=drawing?{x:Math.min(drawing.x,drawing.nowX),y:Math.min(drawing.y,drawing.nowY),width:Math.abs(drawing.nowX-drawing.x),height:Math.abs(drawing.nowY-drawing.y)}:null;
  const imageCandidateHint=candidate?`Expected source hash: ${candidate.sha256}`:'No registered candidate selected.';

  return <main className={styles.page}>
    <div className={styles.wrap}>
      <header className={styles.masthead}><a className={styles.brand} href="/">nutriscan.</a><span className={styles.local}>Local research tool · no OCR · no upload</span></header>
      <section className={styles.intro}>
        <h1>Blind package-label annotation</h1>
        <p>Record what is visibly printed on one real package photograph. The form does not show OCR output, call a provider, or send the image to a server. Two annotators should complete separate passes before comparing labels.</p>
      </section>
      <div className={styles.callout}><strong>Keep the reference independent.</strong> Use an anonymous annotator code. Do not consult OCR results, product databases, label arithmetic, or another annotator’s file. Leave unreadable or absent values blank; do not enter zero by default. Keep both exported passes private until independent work is complete.</div>

      <div className={styles.columns}>
        <section className={styles.stack}>
          <div className={styles.card}>
            <h2>1. Select the source image</h2>
            <p className={styles.sub}>The image stays in this browser tab. Only its SHA-256, dimensions and byte length can enter the exported JSON.</p>
            <div className={styles.form}>
              <label className={styles.control}>Registered candidate (optional)<select value={candidateId} onChange={event=>setCandidateId(event.target.value)}><option value="custom">Custom / other source</option>{candidates.map(item=><option key={item.imageId} value={item.imageId}>{item.productName} · {item.imageId}</option>)}</select><span className={styles.help}>{imageCandidateHint}</span></label>
              <div className={styles.upload}><label className={styles.control}>Package photograph<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>{void handleFile(event.currentTarget.files?.[0]);event.currentTarget.value='';}} disabled={busy}/><span className={styles.help}>JPEG, PNG or WebP · maximum 25 MB / 40 megapixels · processed locally in memory</span></label>
                {image&&<><div className={styles.preview} data-testid="annotation-preview"><img src={image.url} alt="Selected package label for manual annotation"/><svg data-testid="annotation-drawing-surface" className={styles.overlay} viewBox="0 0 1 1" preserveAspectRatio="none" onPointerDown={beginDraw} onPointerMove={continueDraw} onPointerUp={finishDraw} onPointerCancel={()=>setDrawing(null)}>
                  {regions.map(region=>{const x=region.polygon.map(point=>point[0]),y=region.polygon.map(point=>point[1]);return <polygon key={region.regionId} points={region.polygon.map(point=>`${point[0]},${point[1]}`).join(' ')} fill={`${roleColors[region.role]}27`} stroke={roleColors[region.role]} strokeWidth=".004" vectorEffect="non-scaling-stroke"><title>{region.regionId} · {region.role}{region.columnId?` · ${region.columnId}`:''}</title></polygon>;})}
                  {drawingRect&&<rect x={drawingRect.x} y={drawingRect.y} width={drawingRect.width} height={drawingRect.height} fill={`${roleColors[regionRole]}24`} stroke={roleColors[regionRole]} strokeWidth=".004" vectorEffect="non-scaling-stroke"/>}
                </svg></div><div className={styles.meta}><span>{image.width} × {image.height}px</span><span>{image.byteLength.toLocaleString()} bytes</span><code>SHA-256 {image.sha256}</code></div></>}
                {candidate&&image&&!matchesCandidate&&<p className={styles.error}>The selected image does not match the registered candidate hash. Select the correct local image or switch to Custom / other source.</p>}
              </div>
              <div className={styles.grid2}>
                <label className={styles.control}>Image ID<input value={imageId} maxLength={160} onChange={event=>setImageId(event.target.value)}/></label>
                <label className={styles.control}>Product-group ID<input value={productGroupId} maxLength={160} onChange={event=>setProductGroupId(event.target.value)}/><span className={styles.help}>Keep all photos / revisions of one product family together when assigning splits.</span></label>
              </div>
              <div className={styles.grid2}>
                <label className={styles.control}>Annotator code<input value={annotatorCode} maxLength={80} onChange={event=>setAnnotatorCode(event.target.value)} placeholder="Reader A (pseudonym)"/></label>
                <label className={styles.control}>Research split<select value={split} onChange={event=>setSplit(event.target.value as typeof split)}><option value="not-assigned">Not assigned</option><option value="development">Development</option><option value="held-out">Held-out</option></select><span className={styles.help}>Lock product-group splits before any engine uses evaluation images.</span></label>
              </div>
            </div>
          </div>

          <div className={styles.card}>
            <h2>2. Record source and rights provenance</h2>
            <p className={styles.sub}>Candidate metadata is prefilled when a registered source is selected. For other images, record the exact product-page URL and image URL plus uploader and license details.</p>
            <div className={styles.form}>
              <label className={styles.control}>Product page URL<input type="url" value={source.url} onChange={event=>setSource(previous=>({...previous,url:event.target.value}))}/></label>
              <label className={styles.control}>Exact source-image URL<input type="url" value={source.imageUrl} onChange={event=>setSource(previous=>({...previous,imageUrl:event.target.value}))}/></label>
              <div className={styles.grid2}>
                <label className={styles.control}>Publisher<input value={source.publisher} onChange={event=>setSource(previous=>({...previous,publisher:event.target.value}))}/></label>
                <label className={styles.control}>Uploader attribution<input value={source.uploader} onChange={event=>setSource(previous=>({...previous,uploader:event.target.value}))}/></label>
              </div>
              <div className={styles.grid2}>
                <label className={styles.control}>License description<input value={source.licenseId} onChange={event=>setSource(previous=>({...previous,licenseId:event.target.value}))}/></label>
                <label className={styles.control}>License / guidance URL<input type="url" value={source.licenseUrl} onChange={event=>setSource(previous=>({...previous,licenseUrl:event.target.value}))}/></label>
              </div>
              <div className={styles.grid2}>
                <label className={styles.control}>Image retrieval date<input type="date" value={source.retrievedAt} onChange={event=>setSource(previous=>({...previous,retrievedAt:event.target.value}))}/></label>
                <label className={styles.control}>Image-specific redistribution review<select value={source.redistributionReview} onChange={event=>setSource(previous=>({...previous,redistributionReview:event.target.value as AnnotationSource['redistributionReview']}))}><option value="pending">Pending</option><option value="approved">Approved</option><option value="not-approved">Not approved</option><option value="unknown">Unknown</option></select></label>
              </div>
              <label className={styles.control}>Label language<input value={language} maxLength={80} onChange={event=>setLanguage(event.target.value)} placeholder="en, hi, en+hi"/></label>
            </div>
          </div>
        </section>

        <section className={styles.stack}>
          <div className={styles.card}>
            <h2>3. Mark visible regions</h2>
            <p className={styles.sub}>Choose a region type, then drag a rectangle over the package. Rectangles are stored as four-point polygons normalized to the original image. Region labels are independent of OCR.</p>
            <div className={styles.grid2}>
              <label className={styles.control}>Region type<select value={regionRole} onChange={event=>setRegionRole(event.target.value as OcrAnnotatedRegion['role'])}>{Object.keys(roleColors).map(role=><option value={role} key={role}>{role}</option>)}</select></label>
              <label className={styles.control}>Column ID (optional)<input value={regionColumn} maxLength={100} onChange={event=>setRegionColumn(event.target.value)} placeholder="per 100 g / serving"/></label>
            </div>
            <div className={styles.legend}>{Object.entries(roleColors).map(([role,color])=><span key={role}><i className={styles.swatch} style={{background:color}}/>{role}</span>)}</div>
            <div className={styles.rowList}>{regions.length===0?<p className={styles.sub}>No regions drawn yet.</p>:regions.map(region=><div className={styles.regionItem} key={region.regionId}><div><strong style={{color:roleColors[region.role]}}>{region.regionId} · {region.role}</strong><small>{region.columnId||'no column'} · {region.polygon.map(point=>`${point[0].toFixed(3)},${point[1].toFixed(3)}`).join(' ')}</small></div><button type="button" onClick={()=>deleteRegion(region.regionId)}>Remove</button></div>)}</div>
          </div>

          <div className={styles.card}>
            <h2>4. Transcribe each nutrient row</h2>
            <p className={styles.sub}>Add every visible nutrient row. Store the printed number and normalized numeric value separately; preserve the printed unit, table column and basis exactly. For ambiguity, keep known fragments and mark the row ambiguous.</p>
            <div className={styles.form}>
              <div className={styles.grid2}>
                <label className={styles.control}>Field key<input value={draft.key} maxLength={80} onChange={event=>setDraft(previous=>({...previous,key:event.target.value}))} placeholder="e.g. added_sugars"/></label>
                <label className={styles.control}>Printed nutrient label<input value={draft.labelText} maxLength={120} onChange={event=>setDraft(previous=>({...previous,labelText:event.target.value}))} placeholder="Exact label text"/></label>
              </div>
              <div className={styles.grid3}>
                <label className={styles.control}>Printed numeric text<input value={draft.printedNumericText} maxLength={40} onChange={event=>setDraft(previous=>({...previous,printedNumericText:event.target.value}))} placeholder="e.g. 1,2"/></label>
                <label className={styles.control}>Qualifier<select value={draft.numericOperator} onChange={event=>setDraft(previous=>({...previous,numericOperator:event.target.value as Draft['numericOperator']}))}><option value="eq">=</option><option value="lt">&lt;</option><option value="lte">≤</option><option value="gt">&gt;</option><option value="gte">≥</option></select></label>
                <label className={styles.control}>Normalized numeric value<input type="number" min="0" step="any" value={draft.numericValue} onChange={event=>setDraft(previous=>({...previous,numericValue:event.target.value}))} placeholder="Use . decimal"/></label>
              </div>
              <div className={styles.grid2}>
                <label className={styles.control}>Printed unit<input value={draft.unit} maxLength={24} onChange={event=>setDraft(previous=>({...previous,unit:event.target.value}))} placeholder="g, mg, kcal, kJ…"/></label>
                <label className={styles.control}>Serving basis<select value={draft.basisKind} onChange={event=>setDraft(previous=>({...previous,basisKind:event.target.value as OcrBasis['kind']}))}><option value="unknown">Unknown / unreadable</option><option value="per-100g">Per 100 g</option><option value="per-100ml">Per 100 ml</option><option value="per-serving">Per serving</option><option value="per-package">Per package</option><option value="per-unit">Per unit</option><option value="other">Other</option></select></label>
              </div>
              <div className={styles.grid3}>
                <label className={styles.control}>Basis amount<input type="number" min="0" step="any" value={draft.basisAmount} onChange={event=>setDraft(previous=>({...previous,basisAmount:event.target.value}))} placeholder="e.g. 30"/></label>
                <label className={styles.control}>Basis unit<select value={draft.basisUnit} onChange={event=>setDraft(previous=>({...previous,basisUnit:event.target.value as Draft['basisUnit']}))}><option value="g">g</option><option value="ml">ml</option><option value="piece">piece</option></select></label>
                <label className={styles.control}>Reference status<select value={draft.status} onChange={event=>setDraft(previous=>({...previous,status:event.target.value as Draft['status']}))}><option value="clear">Clear</option><option value="ambiguous">Ambiguous</option><option value="not-visible">Not visible</option></select></label>
              </div>
              <label className={styles.control}>Exact printed basis text<input value={draft.basisText} maxLength={160} onChange={event=>setDraft(previous=>({...previous,basisText:event.target.value}))} placeholder="e.g. As sold, per 1 serving (30 g)"/></label>
              <div className={styles.grid2}><label className={styles.control}>Column ID<input value={draft.columnId} maxLength={100} onChange={event=>setDraft(previous=>({...previous,columnId:event.target.value}))} placeholder="100 g / per serving"/></label>{regionSelect('Label region','labelRegionId','label')}</div>
              <div className={styles.grid3}>{regionSelect('Value region','valueRegionId','value')}{regionSelect('Row region','rowRegionId','row')}{regionSelect('Unit region','unitRegionId','unit')}</div>
              {regionSelect('Basis region','basisRegionId','basis')}
              <div className={styles.actions}><button className={styles.secondary} type="button" onClick={addField}>Add nutrient row</button></div>
            </div>
            {fields.length>0&&<div className={styles.fields}>{fields.map(field=><div className={styles.fieldItem} key={field.fieldId}><div><strong>{field.labelText}</strong><small>{field.printedNumericText??'no printed value'} · {field.numericOperator} {field.numericValue??'unreadable'} {field.unit??'unit unknown'} · {field.basisText??field.basis?.kind??'basis unknown'} · {field.status}</small></div><button type="button" onClick={()=>removeField(field.fieldId)}>Remove</button></div>)}</div>}
          </div>

          <div className={styles.card}>
            <h2>5. Export one independent pass</h2>
            <p className={styles.sub}>The JSON follows the shared NutriScan research contract. It contains no image, file name, absolute path, raw OCR, model output or user profile. The exported pass is single-reader and unadjudicated by design.</p>
            {!matchesCandidate&&image&&<p className={styles.error}>Photo hash does not match the selected registered source.</p>}
            <div className={styles.actions}><button className={styles.primary} type="button" onClick={()=>void exportPass()} disabled={busy||!image}>Export annotation JSON</button><button className={styles.secondary} type="button" onClick={()=>{setImage(null);setCandidateId('custom');setImageId('');setProductGroupId('');setSplit('not-assigned');setLanguage('en');setSource(emptySource());setRegions([]);setFields([]);setError('');setNotice('Image annotations and metadata were cleared from this tab.');}}>Clear this pass</button></div>
            {error&&<p className={styles.error} role="alert" style={{marginTop:12}}>{error}</p>}{notice&&<p className={styles.ok} role="status" style={{marginTop:12}}>{notice}</p>}
          </div>
        </section>
      </div>
      <footer className={styles.footer}>Local-only prototype. Do not include package photographs or identifying annotator details in a tracked dataset. A single annotation pass is not a gold reference; two independent passes and adjudication are still required before held-out scoring. <a className={styles.brand} href="/research/ocr-adjudication">Open the local adjudication tool</a></footer>
    </div>
  </main>;
}
