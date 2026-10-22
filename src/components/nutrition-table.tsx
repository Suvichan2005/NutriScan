'use client';

import { Fragment, useState, type FormEvent } from 'react';
import { Check, Eye, Pencil, Plus, X } from 'lucide-react';
import type { Audit, Observation } from '@/lib/contracts';
import { nutrientKeys, type NutrientKey, type PackageData } from '@/lib/contracts';
import type { NutrientCorrection } from '@/lib/correction';
import type { InterpretedNutrientReading } from '@/lib/interpreted-nutrients';

const labels: Record<NutrientKey, string> = {
  energy: 'Energy', carbohydrate: 'Carbohydrate', sugars: 'Total sugars', addedSugars: 'Added sugars',
  protein: 'Protein', fat: 'Total fat', saturatedFat: 'Saturated fat', fiber: 'Fibre', sodium: 'Sodium', salt: 'Salt',
};

function unitsFor(key: NutrientKey): NutrientCorrection['unit'][] {
  if (key === 'energy') return ['kcal', 'kJ'];
  if (key === 'sodium' || key === 'salt') return ['mg', 'g'];
  return ['g'];
}

function display(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
}

type Draft = { key: NutrientKey; value: string; unit: NutrientCorrection['unit']; basis: string; basisUnit: '' | 'g' | 'ml'; sourceObservationIds: string[] };

export function NutritionTable({
  pkg, audit, portion, portionUnit, onSave, canInspect, isInspecting, onInspect, interpretedReadings = [],
}: {
  pkg: PackageData;
  audit: Audit;
  portion: number;
  portionUnit: 'g' | 'ml';
  onSave: (correction: NutrientCorrection) => boolean;
  canInspect: (observation: Observation) => boolean;
  isInspecting: (observation: Observation) => boolean;
  onInspect: (observation: Observation) => void;
  interpretedReadings?: InterpretedNutrientReading[];
}) {
  const [draft, setDraft] = useState<Draft | null>(null);

  function begin(key: NutrientKey) {
    const current = pkg.nutrients.find(item => item.key === key);
    const interpreted = interpretedReadings.find(item => item.key === key && item.basis.unit === portionUnit);
    const useInterpretation = !current || !current.basis;
    const selected = useInterpretation ? interpreted : undefined;
    const basisAmount = selected?.basis.amount ?? current?.basis?.amount;
    const basisUnit = selected?.basis.unit ?? current?.basis?.unit ?? '';
    const value = selected?.value ?? current?.value;
    const unit = selected?.unit ?? current?.unit;
    setDraft({
      key,
      value: value === undefined ? '' : String(value),
      unit: (unit && unitsFor(key).includes(unit as NutrientCorrection['unit']) ? unit : unitsFor(key)[0]) as NutrientCorrection['unit'],
      basis: basisAmount === undefined ? '' : String(basisAmount),
      basisUnit,
      sourceObservationIds: [...new Set([...(current?.observationIds ?? []), ...(selected?.observationIds ?? [])])],
    });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const value = Number(draft.value);
    const basisAmount = Number(draft.basis);
    if (!draft.value || !Number.isFinite(value) || value < 0 || !draft.basis || !Number.isFinite(basisAmount) || basisAmount <= 0 || !draft.basisUnit) return;
    if (onSave({ key: draft.key, value, unit: draft.unit, basisAmount, basisUnit: draft.basisUnit, sourceObservationIds: draft.sourceObservationIds })) setDraft(null);
  }

  const usableKeys = new Set(pkg.nutrients.map(item => item.key));
  for (const reading of interpretedReadings) {
    if (audit.calculations.some(item => item.nutrient === reading.key && reading.candidateIds.some(id => item.interpretationIds?.includes(id)))) usableKeys.add(reading.key);
  }
  const usableCount = usableKeys.size;
  return <details className="nutrition-table-disclosure">
    <summary>Full label table <span>{usableCount} usable readings · {nutrientKeys.length - usableCount} not established</span></summary>
    <div className="nutrition-table-scroll">
      <table className="nutrition-edit-table">
        <thead><tr><th scope="col">Label item</th><th scope="col">Package reading</th><th scope="col">In {portion} {portionUnit}</th><th scope="col"><span className="sr-only">Edit reading</span></th></tr></thead>
        <tbody>{nutrientKeys.map(key => {
          const nutrient = pkg.nutrients.find(item => item.key === key);
          const calculation = audit.calculations.find(item => item.nutrient === key);
          const modelReadings = interpretedReadings.filter(reading => reading.key === key);
          const evidenceIds = new Set([...(nutrient?.observationIds ?? []), ...modelReadings.flatMap(reading => reading.observationIds)]);
          for (const observation of pkg.observations) if (evidenceIds.has(observation.id)) observation.supersedesObservationIds?.forEach(id => evidenceIds.add(id));
          const source = pkg.observations.filter(observation => evidenceIds.has(observation.id));
          const editing = draft?.key === key;
          return <Fragment key={key}><tr className={nutrient?.status === 'corrected' ? 'user-corrected' : undefined}>
            <th scope="row">{labels[key]}{nutrient?.status === 'corrected' && <small className="reading-origin">Your correction</small>}</th>
            <td>{nutrient ? <>{display(nutrient.value)} {nutrient.unit}<small className="reading-basis">{nutrient.basis ? `per ${display(nutrient.basis.amount)} ${nutrient.basis.unit}` : 'basis not established'}</small>{nutrient.status === 'corrected' && <small className="reading-origin">User-corrected · source remains unverified</small>}</> : <span className="reading-missing">Not established</span>}
              {modelReadings.map(reading => {
                const used = !!audit.calculations.find(item => item.nutrient === key && reading.candidateIds.some(id => item.interpretationIds?.includes(id)));
                const modelEvidence = source.filter(observation => reading.observationIds.includes(observation.id));
                return <div className="reading-evidence-item interpreted-reading" key={reading.candidateIds.join('-')}>
                  <small className="reading-origin">Gemini interpretation · unverified{used ? ' · used for this calculation' : ' · not used for this amount'}</small>
                  <strong>{display(reading.value)} {reading.unit}</strong><small className="reading-basis">per {display(reading.basis.amount)} {reading.basis.unit}</small>
                  <details className="reading-evidence"><summary>OCR evidence</summary>{modelEvidence.map(observation => <div className="reading-evidence-item" key={observation.id}><p>OCR observation: “{observation.text}”</p>{canInspect(observation)&&<button className="text-button inspect-region-button" type="button" disabled={isInspecting(observation)} onClick={()=>onInspect(observation)}><Eye size={13}/>{isInspecting(observation)?'Preparing photo…':'Inspect photo region'}</button>}</div>)}</details>
                </div>;
              })}
              {source.length > 0 && <details className="reading-evidence"><summary>Package evidence</summary>{source.map(observation => <div className="reading-evidence-item" key={observation.id}><p>{observation.origin === 'user' ? observation.supersedesObservationIds?.length ? 'User correction' : 'User-provided label text' : observation.origin === 'ocr' ? 'OCR observation' : 'Package observation'}: “{observation.text}”</p>{canInspect(observation)&&<button className="text-button inspect-region-button" type="button" disabled={isInspecting(observation)} onClick={()=>onInspect(observation)}><Eye size={13}/>{isInspecting(observation)?'Preparing photo…':'Inspect photo region'}</button>}</div>)}</details>}
            </td>
            <td>{calculation ? <>{display(calculation.result)} {calculation.unit}{calculation.interpretationIds?.length ? <small className="reading-origin">Unverified interpretation</small> : null}</> : <span className="reading-missing">—</span>}</td>
            <td><button className="nutrition-row-edit" type="button" onClick={() => begin(key)} aria-label={`${nutrient ? 'Edit' : 'Add'} ${labels[key]} label reading`}>{nutrient ? <Pencil size={14}/> : <Plus size={14}/>}<span>{nutrient ? 'Edit' : 'Add'}</span></button></td>
          </tr>{editing && <tr className="nutrition-editor-row"><td colSpan={4}>
              <form className="nutrition-row-editor" onSubmit={save}>
                <label>Label value<input autoFocus required inputMode="decimal" type="number" min="0" step="any" value={draft.value} onChange={event => setDraft({ ...draft, value: event.target.value })}/></label>
                <label>Unit<select value={draft.unit} onChange={event => setDraft({ ...draft, unit: event.target.value as NutrientCorrection['unit'] })}>{unitsFor(key).map(unit => <option key={unit}>{unit}</option>)}</select></label>
                <label>Printed basis<input required inputMode="decimal" type="number" min="0.001" max="10000" step="any" placeholder="e.g. 100" value={draft.basis} onChange={event => setDraft({ ...draft, basis: event.target.value })}/></label>
                <label>Basis unit<select required value={draft.basisUnit} onChange={event => setDraft({ ...draft, basisUnit: event.target.value as '' | 'g' | 'ml' })}><option value="">Choose unit</option><option value="g">g</option><option value="ml">ml</option></select></label>
                <div className="nutrition-row-editor-actions"><button className="text-button" type="button" onClick={() => setDraft(null)}><X size={14}/>Cancel</button><button className="primary-button" type="submit"><Check size={14}/>Save correction</button></div>
                <p>Enter what the package prints. This will be labeled as your correction; it is not independently verified.</p>
              </form>
            </td></tr>}</Fragment>;
        })}</tbody>
      </table>
    </div>
    <p className="nutrition-table-note">Missing is not zero. User corrections update calculations and future package context while keeping earlier observations linked.</p>
  </details>;
}
