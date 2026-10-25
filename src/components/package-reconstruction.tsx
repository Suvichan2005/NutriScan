'use client';

import { useState } from 'react';
import {analysisMethodPolicy} from '@/lib/analysis-method';
import { correctionUnits, type ReconstructionRowEdit } from '@/lib/reconstruction-correction';
import { ScanLine } from 'lucide-react';
import type { PackageReconstruction, NutrientKey, ReconstructionCorrection } from '@/lib/contracts';
import type { NutrientCorrection } from '@/lib/correction';
import { normalizeReconstructedServing } from '@/lib/portion';

type Props = {
  reconstruction: PackageReconstruction;
  history?: PackageReconstruction[];
  savedNutrients: Array<{ key: NutrientKey; value: number; unit: string; basis: { amount: number; unit: 'g' | 'ml' } | null; status: string }>;
  onCorrect: (value: NutrientCorrection) => boolean;
  onInspectEvidence: (observationIds: string[]) => boolean;
  corrections?:ReconstructionCorrection[];
  onCorrectRow?:(edit:ReconstructionRowEdit)=>boolean;
  onActivateRevision?: (revision: number) => boolean;
};

const nutrientAliases: Array<[NutrientKey, RegExp]> = [
  ['addedSugars', /added\s+sugars?/i], ['saturatedFat', /saturat(?:ed)?\s+fat/i],
  ['carbohydrate', /carbohydrat|total\s+carbs?/i], ['sugars', /total\s+sugars?|sugars?/i],
  ['protein', /protein/i], ['fiber', /fibre|fiber|dietary\s+fibre/i], ['sodium', /sodium/i],
  ['salt', /salt/i], ['energy', /energy|calor(?:y|ies)/i], ['fat', /total\s+fat|fat/i],
];
function nutrientKey(label: string): NutrientKey | null {
  return nutrientAliases.find(([, pattern]) => pattern.test(label))?.[0] ?? null;
}
function allowedUnit(key: NutrientKey, printed: string | null): NutrientCorrection['unit'] {
  const unit = printed?.toLowerCase().replace(/\s/g, '');
  if (key === 'energy') return unit === 'kj' ? 'kJ' : 'kcal';
  if ((key === 'sodium' || key === 'salt') && (unit === 'mg' || unit === 'milligram')) return 'mg';
  if (key === 'sodium' || key === 'salt') return 'g';
  return 'g';
}
function statusLabel(status: string) {
  return ({ clear: 'Readable interpretation', provisional: 'Provisional', ambiguous: 'Ambiguous', conflict: 'Conflicting', unreadable: 'Unreadable' } as Record<string, string>)[status] ?? 'Unresolved';
}
function quantityKindLabel(kind:'net-content'|'unit-count'|'servings-per-package'){
  return kind==='net-content'?'Net contents':kind==='unit-count'?'Physical units in pack':'Servings per package';
}

function InterpretedRow({ row, saved, onCorrect, onInspectEvidence }: {
  row: PackageReconstruction['nutritionRows'][number];
  saved?: Props['savedNutrients'][number];
  onCorrect: Props['onCorrect'];
  onInspectEvidence: Props['onInspectEvidence'];
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.value === null ? '' : String(row.value));
  const [basisAmount, setBasisAmount] = useState(row.basisAmount === null ? '' : String(row.basisAmount));
  const [basisUnit, setBasisUnit] = useState<'g' | 'ml'>(row.basisUnit ?? 'g');
  const key = row.nutrientKey === undefined ? nutrientKey(row.nutrient || row.printedLabel) : row.nutrientKey;
  const [unit,setUnit]=useState<NutrientCorrection['unit']>(key?allowedUnit(key,row.unit):'g');
  const startEditing = () => {
    const correction = saved?.status === 'corrected' ? saved : undefined;
    setValue(String(correction?.value ?? row.value ?? ''));
    setBasisAmount(String(correction?.basis?.amount ?? row.basisAmount ?? ''));
    setBasisUnit(correction?.basis?.unit ?? row.basisUnit ?? 'g');
    setUnit(key ? allowedUnit(key, correction?.unit ?? row.unit) : 'g');
    setEditing(true);
  };
  const canSave = Boolean(key && value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0
    && basisAmount.trim() && Number.isFinite(Number(basisAmount)) && Number(basisAmount) > 0);
  return <article className="reconstruction-row" data-reconstruction-row={row.rowId}>
    <div className="reconstruction-row-main">
      <div><strong>{row.nutrient || row.printedLabel}</strong>{row.columnLabel && <small>{row.columnLabel}</small>}</div>
      <div className="reconstruction-value">
        <strong>{row.value === null ? row.printedValue ?? 'Value unresolved' : `${row.value} ${row.unit ?? ''}`.trim()}</strong>
        <small>{row.basisAmount !== null && row.basisUnit ? `per ${row.basisAmount} ${row.basisUnit}` : row.basisText ?? 'Basis unresolved'}</small>
      </div>
    </div>
    {row.qualifier && <p className="reconstruction-qualifier">{row.qualifier}</p>}
    <div className="reconstruction-row-meta"><span>{statusLabel(row.status)} · Gemini reading, not independently verified</span>
      {row.evidence.observationIds.length > 0 && <button type="button" className="text-button" onClick={() => onInspectEvidence(row.evidence.observationIds)}><ScanLine size={13}/>Inspect evidence</button>}
    </div>
    {saved?.status === 'corrected' && saved.basis && <p className="reconstruction-correction"><strong>Your confirmed correction:</strong> {saved.value} {saved.unit} per {saved.basis.amount} {saved.basis.unit}. The original interpretation remains above.</p>}
    {key && !editing && <button className="text-button reconstruction-edit" type="button" onClick={startEditing}>{saved?.status === 'corrected' ? 'Edit your correction' : 'Confirm or edit this value'}</button>}
    {editing && key && <form className="reconstruction-edit-form" onSubmit={event => {
      event.preventDefault();
      if (!canSave) return;
      const ok = onCorrect({ key, value: Number(value), unit, basisAmount: Number(basisAmount), basisUnit,
        sourceObservationIds: row.evidence.observationIds.slice(0, 20) });
      if (ok) setEditing(false);
    }}>
      <label>Printed value<input inputMode="decimal" value={value} onChange={event => setValue(event.target.value)} aria-label={`${row.nutrient} corrected value`}/></label>
      <label>Unit<select value={unit} onChange={event=>setUnit(event.target.value as NutrientCorrection['unit'])} aria-label="Corrected nutrient unit">{key==='energy'?<><option value="kcal">kcal</option><option value="kJ">kJ</option></>:key==='sodium'||key==='salt'?<><option value="mg">mg</option><option value="g">g</option></>:<option value="g">g</option>}</select></label>
      <label>Printed basis<input inputMode="decimal" value={basisAmount} onChange={event => setBasisAmount(event.target.value)} aria-label={`${row.nutrient} basis amount`}/></label>
      <label>Basis unit<select value={basisUnit} onChange={event => setBasisUnit(event.target.value as 'g' | 'ml')}><option value="g">g</option><option value="ml">ml</option></select></label>
      <div><button className="primary-button" disabled={!canSave} type="submit">Save as my correction</button><button className="text-button" type="button" onClick={() => setEditing(false)}>Cancel</button></div>
      <small>This creates a user-confirmed reading with its own evidence link. It does not verify the model interpretation.</small>
    </form>}
  </article>;
}

function ExtraNutrientRow({row,correction,onSave,onInspect}:{row:PackageReconstruction['nutritionRows'][number];correction?:ReconstructionCorrection;onSave?:Props['onCorrectRow'];onInspect:Props['onInspectEvidence']}){
 const [editing,setEditing]=useState(false);
 const source=correction?.original??row,current=correction?.reading??row;
 const [draft,setDraft]=useState({label:current.nutrient,value:String(current.value??''),unit:correctionUnits.includes(current.unit as typeof correctionUnits[number])?current.unit!:'',basis:String(current.basisAmount??''),basisUnit:current.basisUnit??'',qualifier:current.qualifier??''});
 const start=()=>{setDraft({label:current.nutrient,value:String(current.value??''),unit:correctionUnits.includes(current.unit as typeof correctionUnits[number])?current.unit!:'',basis:String(current.basisAmount??''),basisUnit:current.basisUnit??'',qualifier:current.qualifier??''});setEditing(true);};
 const valid=!!draft.label.trim()&&draft.value.trim()!==''&&Number.isFinite(Number(draft.value))&&Number(draft.value)>=0&&Number(draft.value)<=100000&&Number(draft.basis)>0&&Number(draft.basis)<=10000&&correctionUnits.includes(draft.unit as typeof correctionUnits[number])&&['g','ml'].includes(draft.basisUnit)&&['','<','<=','>','>='].includes(draft.qualifier);
 return <article className="reconstruction-row" data-reconstruction-row={row.rowId}>
  <div className="reconstruction-row-main"><div><strong>{source.nutrient}</strong>{source.columnLabel&&<small>{source.columnLabel}</small>}</div><div className="reconstruction-value"><strong>{source.value===null?source.printedValue??'Value unresolved':`${source.value} ${source.unit??''}`}</strong><small>{source.basisAmount!==null&&source.basisUnit?`per ${source.basisAmount} ${source.basisUnit}`:source.basisText??'Basis unresolved'}</small></div></div>
  <div className="reconstruction-row-meta"><span>{statusLabel(source.status)} · original Gemini reading, not independently verified</span>{source.evidence.observationIds.length>0&&<button type="button" className="text-button" onClick={()=>onInspect(source.evidence.observationIds)}><ScanLine size={13}/>Inspect evidence</button>}</div>
  {correction&&<p className="reconstruction-correction"><strong>Your correction · revision {correction.revision}:</strong> {current.nutrient} {current.qualifier}{current.value} {current.unit} per {current.basisAmount} {current.basisUnit}. Original reading retained.</p>}
  {!editing&&onSave&&<button type="button" className="text-button reconstruction-edit" onClick={start}>{correction?'Edit your correction':'Confirm or edit this value'}</button>}
  {editing&&<form className="reconstruction-edit-form" onSubmit={event=>{event.preventDefault();if(valid&&onSave?.({rowId:row.rowId,label:draft.label,value:Number(draft.value),unit:draft.unit as ReconstructionRowEdit['unit'],basisAmount:Number(draft.basis),basisUnit:draft.basisUnit as 'g'|'ml',qualifier:draft.qualifier||null}))setEditing(false);}}>
   <label>Nutrient name<input aria-label="Corrected nutrient name" value={draft.label} onChange={event=>setDraft({...draft,label:event.target.value})}/></label>
   <label>Printed value<input aria-label={`${source.nutrient} corrected value`} inputMode="decimal" value={draft.value} onChange={event=>setDraft({...draft,value:event.target.value})}/></label>
   <label>Unit<select aria-label="Corrected nutrient unit" value={draft.unit} onChange={event=>setDraft({...draft,unit:event.target.value})}><option value="">Select printed unit</option>{correctionUnits.map(unit=><option key={unit} value={unit}>{unit}</option>)}</select></label>
   <label>Qualifier<select aria-label="Corrected qualifier" value={draft.qualifier} onChange={event=>setDraft({...draft,qualifier:event.target.value})}><option value="">Exact value</option>{['<','<=','>','>='].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
   <label>Printed basis<input aria-label={`${source.nutrient} basis amount`} inputMode="decimal" value={draft.basis} onChange={event=>setDraft({...draft,basis:event.target.value})}/></label>
   <label>Basis unit<select aria-label="Corrected basis unit" value={draft.basisUnit} onChange={event=>setDraft({...draft,basisUnit:event.target.value})}><option value="">Select printed basis</option><option value="g">g</option><option value="ml">ml</option></select></label>
   <div><button type="submit" className="primary-button" disabled={!valid}>Save as my correction</button><button type="button" className="text-button" onClick={()=>setEditing(false)}>Cancel</button></div>
   <small>Your reading updates calculations and later questions. It is not independently verified; qualified values remain excluded from exact calculations.</small>
  </form>}
 </article>;
}

export function PackageReconstructionView({ reconstruction, history = [], savedNutrients, onCorrect, onInspectEvidence, onActivateRevision, corrections=[], onCorrectRow }: Props) {
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const displayed = selectedRevision === null ? reconstruction : history.find(item => item.revision === selectedRevision) ?? reconstruction;
  const isActive = selectedRevision === null;
  const isEvidenceMerge = isActive && reconstruction.model.startsWith('local evidence merge');
  const identity = [displayed.identity.brand, displayed.identity.name, displayed.identity.variant].filter(Boolean).join(' ');
  const serving = normalizeReconstructedServing(displayed.serving);
  const quantityDeclarations = displayed.quantityDeclarations ?? [];
  const savedByKey = new Map(savedNutrients.map(item => [item.key, item]));
  return <section className="package-reconstruction" aria-label="Gemini package reconstruction">
    <header><div><span className="eyebrow">PACKAGE UNDERSTANDING</span><h2>{identity || 'Package details'}</h2></div><span className="reconstruction-version">Revision {displayed.revision} · {isActive ? 'active' : 'alternative'}{displayed.analysisMethod?` · ${analysisMethodPolicy(displayed.analysisMethod).label}`:''}</span></header>
    {!isActive && <p className="reconstruction-caveat">This saved package reading is kept for review and is not currently active.</p>}
    {isActive && <p className="reconstruction-caveat">{isEvidenceMerge ? 'Compatible details from saved readings are combined. Conflicting fields remain unresolved and are withheld from calculations.' : 'Gemini’s interpretation is linked to the scan evidence. Confirmed user corrections are stored separately.'}</p>}
    {history.length > 0 && <details className="reconstruction-history"><summary>{history.length} earlier or alternative interpretation{history.length === 1 ? '' : 's'}</summary><ol>{[...history].sort((a,b)=>b.revision-a.revision).map(item=>{
      const title=[item.identity.brand,item.identity.name,item.identity.variant].filter(Boolean).join(' ')||'Unidentified package';
      return <li key={item.revision}><div><strong>Revision {item.revision}</strong><span>{title}</span><small>{item.nutritionRows.length} nutrition rows · {item.ingredients.length} ingredients · {item.model}</small></div><button type="button" className="text-button" onClick={()=>setSelectedRevision(item.revision)}>{selectedRevision===item.revision?'Viewing':'Review'}</button></li>;
    })}</ol></details>}
    {!isActive && <div className="reconstruction-alternative-actions"><button type="button" className="text-button" onClick={()=>setSelectedRevision(null)}>Return to active reading</button>{onActivateRevision&&<button type="button" className="text-button" onClick={()=>{if(onActivateRevision(displayed.revision))setSelectedRevision(null);}}>Use this reading</button>}</div>}
    {serving && <section className="reconstruction-serving"><strong>Serving</strong><span>{serving.pieceCount ? `${serving.pieceCount} ${serving.pieceDescription ?? 'pieces'}` : serving.printedText ?? 'Amount unresolved'}{serving.quantity !== null && serving.unit ? ` · about ${serving.quantity} ${serving.unit}` : ''}</span><small>{statusLabel(serving.status)} · unverified</small>{serving.evidence.observationIds.length > 0 && <button type="button" className="text-button" onClick={() => onInspectEvidence(serving.evidence.observationIds)}>Inspect evidence</button>}</section>}
    {quantityDeclarations.length > 0 && <section><h3>Printed package quantities</h3><ul className="reconstruction-quantity-list">{quantityDeclarations.map((item, index) => <li key={`${item.kind}-${item.quantity}-${item.unit}-${index}`}>
      <div><strong>{quantityKindLabel(item.kind)}</strong><span>{item.quantity !== null && item.unit ? `${item.quantity} ${item.unit}` : item.printedText ?? 'Quantity unresolved'}</span>{item.printedText && item.quantity !== null && <small>Printed wording: {item.printedText}</small>}</div>
      <small>{statusLabel(item.status)} · unverified</small>
      {item.evidence.observationIds.length > 0 && <button type="button" className="text-button" onClick={() => onInspectEvidence(item.evidence.observationIds)}>Inspect evidence</button>}
    </li>)}</ul></section>}
    {displayed.nutritionRows.length > 0 && <section><h3>Nutrition as printed</h3><div className="reconstruction-rows">{displayed.nutritionRows.map(row => {const key=row.nutrientKey===undefined?nutrientKey(row.nutrient || row.printedLabel):row.nutrientKey;if(!key)return <ExtraNutrientRow key={row.rowId} row={row} correction={corrections.find(item=>item.rowId===row.rowId)} onSave={isActive?onCorrectRow:undefined} onInspect={onInspectEvidence}/>;return <InterpretedRow key={row.rowId} row={row} saved={key? savedByKey.get(key):undefined} onCorrect={onCorrect} onInspectEvidence={onInspectEvidence}/>;})}</div></section>}
    {displayed.ingredients.length > 0 && <section><h3>Ingredients</h3><ol className="reconstruction-ingredients">{displayed.ingredients.slice(0, 40).map((item, index) => <li key={`${item.position}-${index}`}><span>{item.normalizedName || item.name}</span>{item.printedPercentage !== null && <strong>{item.printedPercentage}%</strong>}<small>{statusLabel(item.status)} · unverified</small></li>)}</ol></section>}
    {displayed.additives.length > 0 && <section><h3>Additives identified on the label</h3><ul className="reconstruction-statements">{displayed.additives.slice(0, 20).map((item, index) => <li key={`${item.printedName}-${index}`}>{item.normalizedName || item.printedName}{item.code ? ` · ${item.code}` : ''}<small>{statusLabel(item.status)} · unverified</small></li>)}</ul></section>}
    {displayed.statements.length > 0 && <section><h3>Claims and other details</h3><ul className="reconstruction-statements">{displayed.statements.slice(0, 24).map((item, index) => <li key={`${item.kind}-${index}`}><span>{item.text}</span><small>{item.kind} · {statusLabel(item.status)} · unverified</small></li>)}</ul></section>}
    {displayed.unresolved.length > 0 && <details className="reconstruction-unresolved"><summary>{displayed.unresolved.length} details still need clearer evidence</summary><ul>{displayed.unresolved.slice(0, 20).map((item, index) => <li key={`${item.field}-${index}`}><strong>{item.field}</strong> · {item.reason}</li>)}</ul></details>}
  </section>;
}
