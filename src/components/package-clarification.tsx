'use client';

import { useState } from 'react';
import type { PackageData } from '@/lib/contracts';
import { packageConsistencyIssues, type PackageConsistencyIssue } from '@/lib/package-consistency';
import { correctionUnits } from '@/lib/reconstruction-correction';
import type { resolvePackageConsistency } from '@/lib/package-consistency';
import styles from './conversation-clarity.module.css';

export type ClarificationAction = { id: string; choice: number | 'skip'; correction?: Parameters<typeof resolvePackageConsistency>[3] };
export type ClarificationProps = { pkg: PackageData; ids?: string[]; rowIds?: string[]; onResolve?: (action: ClarificationAction) => boolean; onInspect?: (evidence: PackageConsistencyIssue['readings'][number]['row']['evidence']) => void };

export function PackageClarification(props: ClarificationProps) {
  const issue = packageConsistencyIssues(props.pkg).find(item => (!props.ids || props.ids.includes(item.id)) && (!props.rowIds || item.readings.some(reading => props.rowIds!.includes(reading.row.rowId))));
  return issue && props.onResolve ? <ClarificationCard key={issue.id} issue={issue} {...props}/> : null;
}

function ClarificationCard({ issue, onResolve, onInspect }: ClarificationProps & { issue: PackageConsistencyIssue }) {
  const [reviewing, setReviewing] = useState(false), [choice, setChoice] = useState(''), [error, setError] = useState('');
  const [value, setValue] = useState('');
  const [target, setTarget] = useState(0);
  const row = issue.readings[target].row;
  if (issue.decision?.decision === 'skip' && !reviewing) return <div className={styles.clarificationSummary}><span>{issue.label}: estimates retained</span><button type="button" className="text-button" onClick={() => setReviewing(true)}>Review</button></div>;
  const submit = () => {
    if (!choice) { setError('Choose a reading, or continue without clarifying.'); return; }
    if (choice === 'custom' && (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0 || !correctionUnits.some(unit => unit === row.unit))) { setError('Enter a non-negative value in the displayed printed unit.'); return; }
    const action: ClarificationAction = { id: issue.id, choice: choice === 'custom' ? target : Number(choice), ...(choice === 'custom' ? { correction: { value: Number(value), unit: row.unit as typeof correctionUnits[number], basisAmount: row.basisAmount!, basisUnit: row.basisUnit! } } : {}) };
    if (!onResolve?.(action)) setError('That reading could not be saved. Review the current package details.');
  };
  return <section className={styles.clarification} aria-label={`${issue.label} clarification`}>
    <strong>{issue.label}: which reading matches?</strong>
    <p>{issue.reason} You can continue without deciding.</p>
    <fieldset><legend className={styles.srOnly}>Choose a label reading</legend>
      {issue.readings.map((item, index) => <div className={styles.readingOption} key={`${item.revision}-${item.row.rowId}`}><label><input type="radio" name={`reading-${issue.id}`} value={index} checked={choice === String(index)} onChange={() => { setChoice(String(index)); setError(''); }}/><span><strong>{item.row.value} {item.row.unit}</strong> per {item.row.basisAmount} {item.row.basisUnit}<small>{item.current ? 'Current reading' : 'Earlier interpretation'}</small></span></label>{onInspect && <button type="button" className="text-button" onClick={() => onInspect(item.row.evidence)}>View evidence</button>}</div>)}
      <label className={styles.customReading}><input type="radio" name={`reading-${issue.id}`} checked={choice === 'custom'} onChange={() => setChoice('custom')}/>Enter a correction</label>
    </fieldset>
    {choice === 'custom' && <div className={styles.controls}><label>Printed value<input aria-label="Corrected nutrient value" type="number" min="0" step="any" value={value} onChange={event => setValue(event.target.value)}/></label><label>Unit and basis<select aria-label="Correction basis" value={target} onChange={event => setTarget(Number(event.target.value))}>{issue.readings.map((item,index) => <option key={index} value={index}>{item.row.unit} per {item.row.basisAmount} {item.row.basisUnit}</option>)}</select></label></div>}
    {error && <p role="alert">{error}</p>}
    <div className={styles.nutrientActions}><button type="button" className="secondary-button" onClick={submit}>Use this reading</button><button type="button" className="text-button" onClick={() => { if (!onResolve?.({ id: issue.id, choice: 'skip' })) setError('The package changed. Review its current details.'); setReviewing(false); }}>Continue with estimates</button></div>
    <details className={styles.details}><summary>What changes?</summary><p>Your choice becomes a saved user reading for calculations and future answers. Other printed readings remain in the evidence. No Gemini request is needed, and this does not independently verify the label.</p></details>
  </section>;
}
