'use client';

import { useState } from 'react';
import type { Calculation, PackageData } from '@/lib/contracts';
import { convertPortion, portionView, scalePortion, type PortionUnit } from '@/lib/portion-view';
import { portionNutrientGroups } from '@/lib/portion-nutrients';
import { consistencyRange, packageConsistencyIssues } from '@/lib/package-consistency';
import { PackageClarification, type ClarificationProps } from './package-clarification';
import styles from './conversation-clarity.module.css';

const number = (value: number) => value.toLocaleString('en-IN', value !== 0 && Math.abs(value) < .01 ? { maximumSignificantDigits: 3 } : { maximumFractionDigits: 2 });

export function PortionCalculator({ rows, pkg, onReview, initialPhysical, onAmountChange, onResolveClarification, onInspectEvidence, suppressedIssueIds=[] }: { rows: Calculation[]; pkg: PackageData; onReview?: () => void; initialPhysical?: { amount: number; unit: 'g' | 'ml' }; onAmountChange?: (amount: number, unit: 'g' | 'ml') => void; onResolveClarification?: ClarificationProps['onResolve']; onInspectEvidence?: ClarificationProps['onInspect']; suppressedIssueIds?: string[] }) {
  const view = portionView(rows[0], pkg);
  const start = !rows[0].countedPortion && !rows[0].packagePortion && initialPhysical?.unit === rows[0].portionUnit ? initialPhysical.amount : view.initial.amount;
  const [amount, setAmount] = useState(String(start));
  const [unit, setUnit] = useState<PortionUnit>(view.initial.unit);
  const choices = portionNutrientGroups(pkg, rows);
  const defaults = choices.filter(choice => choice.initial && choice.calculation).map(({id,subject}) => ({id,subject}));
  const [selected, setSelected] = useState(defaults);
  const selectedIds = new Set(selected.flatMap(selection => {
    const exact = choices.find(choice => choice.id === selection.id && choice.calculation);
    if (exact) return [exact.id];
    const replacements = choices.filter(choice => choice.subject === selection.subject && choice.calculation);
    return replacements.length === 1 ? [replacements[0].id] : [];
  }));
  const visible = choices.filter(choice => selectedIds.has(choice.id) && choice.calculation);
  const displayed = visible.flatMap(choice => choice.calculation ? [choice.calculation] : []);
  const issues = packageConsistencyIssues(pkg);
  const relevantIssueIds = issues.filter(issue => !suppressedIssueIds.includes(issue.id) && displayed.some(row => issue.readings.some(reading => row.interpretationIds?.includes(reading.row.rowId)))).map(issue => issue.id);
  const option = view.options.find(item => item.unit === unit);
  const valid = Boolean(option && amount.trim() && Number.isFinite(Number(amount)) && Number(amount) > 0 && Number(amount) <= 10_000 && Number(amount) * option.quantity <= 10_000);
  const estimated = displayed.some(row => row.inputOrigin !== 'user-correction' && Boolean(row.interpretationIds?.length || row.countedPortion || row.packagePortion));
  const label = (row: Calculation) => {
    const source = pkg.reconstruction?.nutritionRows.find(item => row.interpretationIds?.includes(item.rowId));
    const text = source?.printedLabel || source?.nutrient || row.nutrientLabel || (row.nutrient ? row.nutrient.replace(/([a-z])([A-Z])/g, '$1 $2') : row.label);
    return text.slice(0, 1).toLocaleUpperCase('en') + text.slice(1);
  };
  return <section className={`thread-ui-card ${styles.portion}`} aria-label="Portion calculator" data-testid="thread-ui-component-portion-calculator">
    <div className={styles.portionHeading}><strong>Your portion</strong>{estimated && <span className={styles.badge}>Label estimate</span>}</div>
    <div className={styles.controls}>
      <label>Amount<input aria-label="Portion amount" type="number" inputMode="decimal" min="0" max="10000" step="any" value={amount} onChange={event => {
        setAmount(event.target.value);
        const physical = Number(event.target.value) * (option?.quantity ?? 0);
        if (option && Number.isFinite(physical) && physical > 0 && physical <= 10_000) onAmountChange?.(physical, option.basisUnit);
      }}/></label>
      <label>Measured in<select aria-label="Portion unit" value={unit} onChange={event => {
        const next = view.options.find(item => item.unit === event.target.value);
        if (!option || !next) return;
        const converted = convertPortion(Number(amount), option, next);
        if (converted === null) return;
        setAmount(String(Number(converted.toPrecision(12)))); setUnit(next.unit);
      }}>{view.options.map(item => <option key={item.unit} value={item.unit}>{item.label}</option>)}</select></label>
    </div>
    <details className={`${styles.details} ${styles.nutrientPicker}`}><summary>Choose nutrients <span>{visible.length} selected</span></summary>
      <fieldset className={styles.nutrientChoices}><legend>Choose what to display</legend>
        {choices.map(choice => <label key={choice.id}><input type="checkbox" checked={Boolean(choice.calculation && selectedIds.has(choice.id))} disabled={!choice.calculation} onChange={event => setSelected(current => event.target.checked ? [...current, {id:choice.id,subject:choice.subject}] : current.filter(selection => selection.id !== choice.id && !(selection.subject === choice.subject && !choices.some(item=>item.id===selection.id&&item.calculation))))}/><span>{choice.label}{choice.reason && <small>{choice.reason}</small>}</span></label>)}
      </fieldset>
      <div className={styles.nutrientActions}><button type="button" className="text-button" onClick={() => setSelected(choices.filter(choice => choice.calculation).map(({id,subject})=>({id,subject})))}>Show all available</button><button type="button" className="text-button" onClick={() => setSelected(defaults)}>Reset selection</button></div>
      <p className={styles.pickerHint}>Changes stay on your device. Missing values and printed limits cannot be used as exact amounts.</p>
    </details>
    {!valid && <p role="status">Enter a positive amount to calculate.</p>}
    {!displayed.length && <p role="status">Choose a nutrient to see its amount.</p>}
    {valid && option && <p className={styles.portionSummary}>For {number(Number(amount))} {option.label}{option.unit !== option.basisUnit ? ` · ${number(Number(amount) * option.quantity)} ${option.basisUnit}` : ''}</p>}
    <ul className={`${styles.results} ${styles.resultGrid}`} aria-live="polite">{visible.map(choice => {
      const row = choice.calculation!;
      const value = valid && option ? scalePortion(row, Number(amount), option) : null;
      const issue = issues.find(item => item.readings.some(reading => row.interpretationIds?.includes(reading.row.rowId)));
      const range = issue && valid && option ? consistencyRange(issue, Number(amount) * option.quantity, option.basisUnit, row.unit) : null;
      return <li key={choice.id}><span>{label(row)}</span><strong>{range && range[0] !== range[1] ? `${number(range[0])}–${number(range[1])} ${row.unit}` : value === null ? 'Not calculated' : `${number(value)} ${row.unit}`}</strong>{range && <small className={styles.resultBasis}>Depends on the label reading</small>}</li>;
    })}</ul>
    <PackageClarification pkg={pkg} ids={relevantIssueIds} onResolve={onResolveClarification} onInspect={onInspectEvidence}/>
    <details className={styles.details}><summary>Calculation &amp; label details</summary>
      {valid && option && <p>{number(Number(amount))} {option.label}{option.unit !== option.basisUnit ? ` = ${number(Number(amount) * option.quantity)} ${option.basisUnit}` : ''}{rows[0].countedPortion && option.basisUnit === rows[0].countedPortion.servingUnit ? ` · ${number(Number(amount) * option.quantity / rows[0].countedPortion.servingQuantity)} label servings` : ''}.</p>}
      <ul>{visible.flatMap(choice => choice.alternatives.flatMap(alternative => alternative.calculation ? [alternative.calculation] : [])).map(row => <li key={row.id}>{label(row)}: {number(row.input)} {row.inputUnit} per {number(row.basisAmount)} {row.portionUnit}. {valid && option && option.basisUnit === row.portionUnit ? `${number(row.input)} × ${number(Number(amount) * option.quantity)} ÷ ${number(row.basisAmount)}.` : 'No mass-to-volume conversion is available.'}</li>)}</ul>
      <p>{estimated ? 'Calculated from label readings that have not been confirmed. Check the linked package details before relying on a disputed value.' : 'Calculated from the saved label values and their measurement basis.'} This calculation is not a recommended portion.</p>
      {onReview && <button type="button" className="text-button" onClick={onReview}>Review label values</button>}
    </details>
  </section>;
}
