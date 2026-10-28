'use client';

import { useState } from 'react';
import {nutrientMassConflict} from '@/lib/nutrient-mass';
import {analysisMethodPolicy} from '@/lib/analysis-method';
import { correctionUnits, type ReconstructionRowEdit } from '@/lib/reconstruction-correction';
import { ScanLine } from 'lucide-react';
import type { PackageReconstruction, NutrientKey, ReconstructionCorrection } from '@/lib/contracts';
import type { NutrientCorrection } from '@/lib/correction';
import { normalizeReconstructedServing } from '@/lib/portion';
import { reconstructedIdentity } from '@/lib/reconstruction-presentation';
import styles from './conversation-clarity.module.css';

type Props = {
  reconstruction: PackageReconstruction;
  history?: PackageReconstruction[];
  savedNutrients: Array<{ key: NutrientKey; value: number; unit: string; basis: { amount: number; unit: 'g' | 'ml' } | null; status: string }>;
  onCorrect: (value: NutrientCorrection) => boolean;
  onInspectEvidence: (observationIds: string[], imageRegions?: Array<{imageId:string}>) => boolean;
  retainedRows?: PackageReconstruction['nutritionRows'];
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
  const massConflict=nutrientMassConflict({nutrientKey:key,value:Number(value),unit,basisAmount:Number(basisAmount),basisUnit});
  const canSave = Boolean(!massConflict && key && value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0
    && basisAmount.trim() && Number.isFinite(Number(basisAmount)) && Number(basisAmount) > 0);
  return <article className="reconstruction-row" data-reconstruction-row={row.rowId} data-reading-status={row.status} title={statusLabel(row.status)}>
    <div className="reconstruction-row-main">
      <div><strong>{row.nutrient || row.printedLabel}</strong>{row.columnLabel && <small>{row.columnLabel}</small>}</div>
      <div className="reconstruction-value">
        <strong>{row.value === null ? row.printedValue ?? 'Not read' : `${row.value} ${row.unit ?? ''}`.trim()}</strong>
        <small>{row.basisAmount !== null && row.basisUnit ? `per ${row.basisAmount} ${row.basisUnit}` : row.basisText ?? (row.value===null?'':'Basis not established')}</small>
      </div>
    </div>
    {row.qualifier && <p className="reconstruction-qualifier">{row.qualifier}</p>}
    <div className="reconstruction-row-meta">{['ambiguous','conflict'].includes(row.status)&&<span className={styles.needsReview}>{statusLabel(row.status)} · review this reading</span>}
      {(row.evidence.observationIds.length > 0 || row.evidence.imageRegions.length > 0) && <button type="button" className="text-button" onClick={() => onInspectEvidence(row.evidence.observationIds,row.evidence.imageRegions)}><ScanLine size={13}/>Inspect evidence</button>}
    </div>
    {saved?.status === 'corrected' && saved.basis && <p className="reconstruction-correction"><strong>Your confirmed correction:</strong> {saved.value} {saved.unit} per {saved.basis.amount} {saved.basis.unit}. The original interpretation remains above.</p>}
    {key && !editing && <button className="text-button reconstruction-edit" type="button" aria-label={`Review ${row.nutrient || row.printedLabel} ${row.columnLabel || row.basisText || "reading"}`} onClick={startEditing}>{saved?.status === 'corrected' ? 'Edit your correction' : 'Review value'}</button>}
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
      {massConflict&&<p className="reconstruction-caveat" role="alert">{massConflict}</p>}
      <small>This creates a user-confirmed reading with its own evidence link. It does not verify the model interpretation.</small>
    </form>}
  </article>;
}

const nutrientLabels: Array<[NutrientKey, string]> = [
  ['energy', 'Energy'], ['carbohydrate', 'Carbohydrate'], ['sugars', 'Sugars'],
  ['addedSugars', 'Added sugars'], ['protein', 'Protein'], ['fat', 'Total fat'],
  ['saturatedFat', 'Saturated fat'], ['fiber', 'Fibre'], ['sodium', 'Sodium'], ['salt', 'Salt'],
];

function AddMissingNutrient({ savedNutrients, onCorrect }: Pick<Props, 'savedNutrients' | 'onCorrect'>) {
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState<NutrientKey>('carbohydrate');
  const [value, setValue] = useState('');
  const [basisAmount, setBasisAmount] = useState('');
  const [basisUnit, setBasisUnit] = useState<'g' | 'ml'>('g');
  const [unit, setUnit] = useState<NutrientCorrection['unit']>('g');
  const available = nutrientLabels.filter(([candidate]) => !savedNutrients.some(item => item.key === candidate));
  const selectedKey = available.some(([candidate]) => candidate === key) ? key : available[0]?.[0];
  const selectedUnit: NutrientCorrection['unit'] = selectedKey === 'energy' ? (unit === 'kJ' ? 'kJ' : 'kcal')
    : selectedKey === 'sodium' || selectedKey === 'salt' ? (unit === 'mg' ? 'mg' : 'g') : 'g';
  const massConflict = selectedKey ? nutrientMassConflict({
    nutrientKey: selectedKey, value: Number(value), unit: selectedUnit, basisAmount: Number(basisAmount), basisUnit,
  }) : null;
  const canSave = Boolean(selectedKey && !massConflict && value.trim() && Number.isFinite(Number(value))
    && Number(value) >= 0 && basisAmount.trim() && Number.isFinite(Number(basisAmount)) && Number(basisAmount) > 0);
  const selectKey = (next: NutrientKey) => {
    setKey(next);
    setUnit(next === 'energy' ? 'kcal' : 'g');
  };

  if (!available.length) return null;
  if (!editing) return <button className="text-button reconstruction-edit" type="button" onClick={() => setEditing(true)}>Add a missing nutrient value</button>;

  return <form className="reconstruction-edit-form" aria-label="Add a missing nutrient value" onSubmit={event => {
    event.preventDefault();
    if (!canSave || !selectedKey) return;
    const ok = onCorrect({ key: selectedKey, value: Number(value), unit: selectedUnit, basisAmount: Number(basisAmount), basisUnit });
    if (ok) setEditing(false);
  }}>
    <p>Enter a value you have read from the package. This saves your reading as a user correction; it is not independently verified.</p>
    <label>Nutrient<select aria-label="Missing nutrient" value={selectedKey ?? ''} onChange={event => selectKey(event.target.value as NutrientKey)}>
      {available.map(([candidate, label]) => <option key={candidate} value={candidate}>{label}</option>)}
    </select></label>
    <label>Value you read<input aria-label="Missing nutrient value" inputMode="decimal" value={value} onChange={event => setValue(event.target.value)}/></label>
    <label>Unit<select aria-label="Missing nutrient unit" value={selectedUnit} onChange={event => setUnit(event.target.value as NutrientCorrection['unit'])}>
      {selectedKey === 'energy' ? <><option value="kcal">kcal</option><option value="kJ">kJ</option></>
        : selectedKey === 'sodium' || selectedKey === 'salt' ? <><option value="g">g</option><option value="mg">mg</option></>
          : <option value="g">g</option>}
    </select></label>
    <label>Label basis<input aria-label="Missing nutrient basis amount" inputMode="decimal" value={basisAmount} onChange={event => setBasisAmount(event.target.value)}/></label>
    <label>Basis unit<select aria-label="Missing nutrient basis unit" value={basisUnit} onChange={event => setBasisUnit(event.target.value as 'g' | 'ml')}><option value="g">g</option><option value="ml">ml</option></select></label>
    <div><button className="primary-button" disabled={!canSave} type="submit">Save my reading</button><button className="text-button" type="button" onClick={() => setEditing(false)}>Cancel</button></div>
    {massConflict && <p className="reconstruction-caveat" role="alert">{massConflict}</p>}
  </form>;
}

function ExtraNutrientRow({row,correction,onSave,onInspect}:{row:PackageReconstruction['nutritionRows'][number];correction?:ReconstructionCorrection;onSave?:Props['onCorrectRow'];onInspect:Props['onInspectEvidence']}){
 const [editing,setEditing]=useState(false);
 const source=correction?.original??row,current=correction?.reading??row;
 const [draft,setDraft]=useState({label:current.nutrient,value:String(current.value??''),unit:correctionUnits.includes(current.unit as typeof correctionUnits[number])?current.unit!:'',basis:String(current.basisAmount??''),basisUnit:current.basisUnit??'',qualifier:current.qualifier??''});
 const start=()=>{setDraft({label:current.nutrient,value:String(current.value??''),unit:correctionUnits.includes(current.unit as typeof correctionUnits[number])?current.unit!:'',basis:String(current.basisAmount??''),basisUnit:current.basisUnit??'',qualifier:current.qualifier??''});setEditing(true);};
 const valid=!!draft.label.trim()&&draft.value.trim()!==''&&Number.isFinite(Number(draft.value))&&Number(draft.value)>=0&&Number(draft.value)<=100000&&Number(draft.basis)>0&&Number(draft.basis)<=10000&&correctionUnits.includes(draft.unit as typeof correctionUnits[number])&&['g','ml'].includes(draft.basisUnit)&&['','<','<=','>','>='].includes(draft.qualifier);
 return <article className="reconstruction-row" data-reconstruction-row={row.rowId} data-reading-status={row.status} title={statusLabel(row.status)}>
  <div className="reconstruction-row-main"><div><strong>{source.nutrient}</strong>{source.columnLabel&&<small>{source.columnLabel}</small>}</div><div className="reconstruction-value"><strong>{source.value===null?source.printedValue??'Not read':`${source.value} ${source.unit??''}`}</strong><small>{source.basisAmount!==null&&source.basisUnit?`per ${source.basisAmount} ${source.basisUnit}`:source.basisText??(source.value===null?'':'Basis not established')}</small></div></div>
  <div className="reconstruction-row-meta">{['ambiguous','conflict'].includes(source.status)&&<span className={styles.needsReview}>{statusLabel(source.status)} · review this reading</span>}{(source.evidence.observationIds.length>0||source.evidence.imageRegions.length>0)&&<button type="button" className="text-button" onClick={()=>onInspect(source.evidence.observationIds,source.evidence.imageRegions)}><ScanLine size={13}/>Inspect evidence</button>}</div>
  {correction&&<p className="reconstruction-correction"><strong>Your correction · revision {correction.revision}:</strong> {current.nutrient} {current.qualifier}{current.value} {current.unit} per {current.basisAmount} {current.basisUnit}. Original reading retained.</p>}
  {!editing&&onSave&&<button type="button" className="text-button reconstruction-edit" aria-label={`Review ${source.nutrient} ${source.columnLabel || source.basisText || "reading"}`} onClick={start}>{correction?'Edit your correction':'Review value'}</button>}
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

export function PackageReconstructionView({ reconstruction, history = [], savedNutrients, onCorrect, onInspectEvidence, onActivateRevision, corrections=[], onCorrectRow, retainedRows=[] }: Props) {
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const displayed = selectedRevision === null ? reconstruction : history.find(item => item.revision === selectedRevision) ?? reconstruction;
  const isActive = selectedRevision === null;
  const isEvidenceMerge = isActive && reconstruction.model.startsWith('local evidence merge');
  const identity = reconstructedIdentity(displayed.identity);
  const serving = normalizeReconstructedServing(displayed.serving);
  const quantityDeclarations = displayed.quantityDeclarations ?? [];
  const savedByKey = new Map(savedNutrients.map(item => [item.key, item]));
  const addedReadings = isActive ? savedNutrients.filter(item => item.status === 'corrected'
    && !displayed.nutritionRows.some(row => (row.nutrientKey === undefined ? nutrientKey(row.nutrient || row.printedLabel) : row.nutrientKey) === item.key))
    : [];
  return <section className={`package-reconstruction ${styles.package}`} aria-label="Gemini package reconstruction">
    <header><div><span className="eyebrow">PACKAGE UNDERSTANDING</span><h2>{identity || 'Package details'}</h2></div></header>
    {!isActive && <p className="reconstruction-caveat">You are reviewing an earlier reading.</p>}
    <div className={styles.packageNote}><p>AI label readings · not independently verified. Review uncertain or missing values before relying on them.</p>
      <details><summary>About these readings</summary><p>Readings are linked to the original evidence. A readable value is still an interpretation; your confirmed corrections are saved separately. Missing values are not zero.</p><p className={styles.packageMeta}>Revision {displayed.revision} · {isActive ? 'active' : 'alternative'}{displayed.analysisMethod?` · ${analysisMethodPolicy(displayed.analysisMethod).label}`:''} · {displayed.model}</p>{isEvidenceMerge&&<p>Compatible saved readings are combined. Conflicting values remain excluded from calculations.</p>}</details>
    </div>
    {retainedRows.length>0&&<details className="reconstruction-history"><summary>Other printed readings retained</summary><ul>{retainedRows.map(row=><li key={row.rowId}>{row.printedLabel||row.nutrient}: {row.printedValue??row.value} {row.unit} per {row.basisAmount} {row.basisUnit} <button type="button" className="text-button" onClick={()=>onInspectEvidence(row.evidence.observationIds,row.evidence.imageRegions)}>Inspect evidence</button></li>)}</ul><small>Your selected reading is used for calculations; these alternatives have not been overwritten.</small></details>}
    {history.length > 0 && <details className="reconstruction-history"><summary>{history.length} earlier or alternative interpretation{history.length === 1 ? '' : 's'}</summary><ol>{[...history].sort((a,b)=>b.revision-a.revision).map(item=>{
      const title=reconstructedIdentity(item.identity)||'Unidentified package';
      return <li key={item.revision}><div><strong>Revision {item.revision}</strong><span>{title}</span><small>{item.nutritionRows.length} nutrition rows · {item.ingredients.length} ingredients · {item.model}</small></div><button type="button" className="text-button" onClick={()=>setSelectedRevision(item.revision)}>{selectedRevision===item.revision?'Viewing':'Review'}</button></li>;
    })}</ol></details>}
    {!isActive && <div className="reconstruction-alternative-actions"><button type="button" className="text-button" onClick={()=>setSelectedRevision(null)}>Return to active reading</button>{onActivateRevision&&<button type="button" className="text-button" onClick={()=>{if(onActivateRevision(displayed.revision))setSelectedRevision(null);}}>Use this reading</button>}</div>}
    {serving && <section className="reconstruction-serving"><strong>Serving</strong><span>{serving.pieceCount ? `${serving.pieceCount} ${serving.pieceDescription ?? 'pieces'}` : serving.printedText ?? 'Amount unresolved'}{(serving.pieceCount || !serving.printedText) && serving.quantity !== null && serving.unit ? ` · about ${serving.quantity} ${serving.unit}` : ''}</span>{['ambiguous','conflict','unreadable'].includes(serving.status)&&<small className={styles.needsReview}>{statusLabel(serving.status)}</small>}{(serving.evidence.observationIds.length > 0 || serving.evidence.imageRegions.length > 0) && <button type="button" className="text-button" onClick={() => onInspectEvidence(serving.evidence.observationIds,serving.evidence.imageRegions)}>Inspect evidence</button>}</section>}
    {quantityDeclarations.length > 0 && <section><h3>Printed package quantities</h3><ul className="reconstruction-quantity-list">{quantityDeclarations.map((item, index) => <li key={`${item.kind}-${item.quantity}-${item.unit}-${index}`}>
      <div><strong>{quantityKindLabel(item.kind)}</strong><span>{item.quantity !== null && item.unit ? `${item.quantity} ${item.unit}` : item.printedText ?? 'Quantity unresolved'}</span>{item.printedText && item.quantity !== null && <small>Printed wording: {item.printedText}</small>}</div>
      {['ambiguous','conflict','unreadable'].includes(item.status)&&<small className={styles.needsReview}>{statusLabel(item.status)}</small>}
      {(item.evidence.observationIds.length > 0 || item.evidence.imageRegions.length > 0) && <button type="button" className="text-button" onClick={() => onInspectEvidence(item.evidence.observationIds,item.evidence.imageRegions)}>Inspect evidence</button>}
    </li>)}</ul></section>}
    {(displayed.nutritionRows.length > 0 || isActive) && <section><h3>Nutrition as printed</h3>{displayed.nutritionRows.length > 0 && <div className="reconstruction-rows">{displayed.nutritionRows.map(row => {const key=row.nutrientKey===undefined?nutrientKey(row.nutrient || row.printedLabel):row.nutrientKey;if(!key)return <ExtraNutrientRow key={row.rowId} row={row} correction={corrections.find(item=>item.rowId===row.rowId)} onSave={isActive?onCorrectRow:undefined} onInspect={onInspectEvidence}/>;return <InterpretedRow key={row.rowId} row={row} saved={key? savedByKey.get(key):undefined} onCorrect={onCorrect} onInspectEvidence={onInspectEvidence}/>;})}</div>}{addedReadings.length > 0 && <div className="reconstruction-rows" aria-label="User-supplied readings">{addedReadings.map(item => <article className="reconstruction-row" key={item.key}><div className="reconstruction-row-main"><div><strong>{nutrientLabels.find(([key])=>key===item.key)?.[1] ?? item.key}</strong><small>Your supplied reading</small></div><div className="reconstruction-value"><strong>{item.value} {item.unit}</strong><small>{item.basis ? `per ${item.basis.amount} ${item.basis.unit}` : 'Basis unresolved'}</small></div></div><small>Your saved reading</small></article>)}</div>}{isActive && <AddMissingNutrient savedNutrients={savedNutrients} onCorrect={onCorrect}/>}</section>}
    {displayed.ingredients.length > 0 && <section><h3>Ingredients</h3><ol className="reconstruction-ingredients">{displayed.ingredients.slice(0, 40).map((item, index) => <li key={`${item.position}-${index}`}><span>{item.normalizedName || item.name}</span>{item.printedPercentage !== null && <strong>{item.printedPercentage}%</strong>}{['ambiguous','conflict','unreadable'].includes(item.status)&&<small className={styles.needsReview}>{statusLabel(item.status)}</small>}</li>)}</ol></section>}
    {displayed.additives.length > 0 && <section><h3>Additives identified on the label</h3><ul className="reconstruction-statements">{displayed.additives.slice(0, 20).map((item, index) => <li key={`${item.printedName}-${index}`}>{item.normalizedName || item.printedName}{item.code ? ` · ${item.code}` : ''}{['ambiguous','conflict','unreadable'].includes(item.status)&&<small className={styles.needsReview}>{statusLabel(item.status)}</small>}</li>)}</ul></section>}
    {displayed.statements.length > 0 && <section><h3>Claims and other details</h3><ul className="reconstruction-statements">{displayed.statements.slice(0, 24).map((item, index) => <li key={`${item.kind}-${index}`}><span>{item.text}</span><small>{item.kind}{['ambiguous','conflict','unreadable'].includes(item.status)?` · ${statusLabel(item.status)}`:''}</small></li>)}</ul></section>}
    {displayed.unresolved.length > 0 && <details className="reconstruction-unresolved"><summary>{displayed.unresolved.length} details still need clearer evidence</summary><ul>{displayed.unresolved.slice(0, 20).map((item, index) => <li key={`${item.field}-${index}`}><strong>{item.field}</strong> · {item.reason}</li>)}</ul></details>}
  </section>;
}
