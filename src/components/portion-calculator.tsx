'use client';

import { useState } from 'react';
import type { Calculation, PackageData } from '@/lib/contracts';
import { convertPortion, portionView, scalePortion, type PortionUnit } from '@/lib/portion-view';
import styles from './conversation-clarity.module.css';

const number = (value: number) => Number(value.toFixed(2)).toLocaleString('en-IN');

export function PortionCalculator({ rows, pkg, onReview, initialPhysical, onAmountChange }: { rows: Calculation[]; pkg: PackageData; onReview?: () => void; initialPhysical?: { amount: number; unit: 'g' | 'ml' }; onAmountChange?: (amount: number, unit: 'g' | 'ml') => void }) {
  const view = portionView(rows[0], pkg);
  const start = !rows[0].countedPortion && !rows[0].packagePortion && initialPhysical?.unit === rows[0].portionUnit ? initialPhysical.amount : view.initial.amount;
  const [amount, setAmount] = useState(String(start));
  const [unit, setUnit] = useState<PortionUnit>(view.initial.unit);
  const option = view.options.find(item => item.unit === unit);
  const valid = Boolean(option && amount.trim() && Number.isFinite(Number(amount)) && Number(amount) > 0 && Number(amount) <= 10_000 && Number(amount) * option.quantity <= 10_000);
  const estimated = rows.some(row => row.inputOrigin !== 'user-correction' && Boolean(row.interpretationIds?.length || row.countedPortion || row.packagePortion));
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
    {!valid && <p role="status">Enter a positive amount to calculate.</p>}
    <ul className={styles.results}>{rows.map(row => {
      const value = valid && option ? scalePortion(row, Number(amount), option) : null;
      return <li key={row.id}><span>{label(row)}</span><strong>{value === null ? 'Not calculated' : `${number(value)} ${row.unit}`}</strong></li>;
    })}</ul>
    <details className={styles.details}><summary>Calculation &amp; label details</summary>
      {valid && option && <p>{number(Number(amount))} {option.label}{option.unit !== option.basisUnit ? ` = ${number(Number(amount) * option.quantity)} ${option.basisUnit}` : ''}{rows[0].countedPortion && option.basisUnit === rows[0].countedPortion.servingUnit ? ` · ${number(Number(amount) * option.quantity / rows[0].countedPortion.servingQuantity)} label servings` : ''}.</p>}
      <ul>{rows.map(row => <li key={row.id}>{label(row)}: {number(row.input)} {row.inputUnit} per {number(row.basisAmount)} {row.portionUnit}. {valid && option && option.basisUnit === row.portionUnit ? `${number(row.input)} × ${number(Number(amount) * option.quantity)} ÷ ${number(row.basisAmount)}.` : 'No mass-to-volume conversion is available.'}</li>)}</ul>
      <p>{estimated ? 'Calculated from label readings that have not been confirmed. Check the linked package details before relying on a disputed value.' : 'Calculated from the saved label values and their measurement basis.'} This calculation is not a recommended portion.</p>
      {onReview && <button type="button" className="text-button" onClick={onReview}>Review label values</button>}
    </details>
  </section>;
}
