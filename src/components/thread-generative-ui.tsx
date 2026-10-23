'use client';

import type { ReactNode } from 'react';
import { BookOpen, ChevronDown, CircleHelp, Eye, PackageSearch, ScanLine, Sparkles } from 'lucide-react';
import { compareProductNutrition, type ProductComparisonRow } from '@/lib/product-comparison';
import { productEvidenceSource } from '@/lib/product-evidence';
import { isSafeEvidenceUrl, safeConversationEvidence } from '@/lib/followup-evidence';
import type { AssistantUiComponent, Audit, EvidenceSource, Observation, PackageData, ProductRecord, TentativeStructuredCandidate, NutrientKey } from '@/lib/contracts';
import type { NutrientCorrection } from '@/lib/correction';
import type { InterpretedNutrientReading } from '@/lib/interpreted-nutrients';
import { NutritionTable } from './nutrition-table';

const nutrientLabels: Record<NutrientKey, string> = {
  energy: 'Energy', carbohydrate: 'Carbohydrate', sugars: 'Total sugars', addedSugars: 'Added sugars',
  protein: 'Protein', fat: 'Total fat', saturatedFat: 'Saturated fat', fiber: 'Fibre', sodium: 'Sodium', salt: 'Salt',
};

function formatNumber(value: number) { return Number(value.toFixed(2)).toLocaleString('en-IN'); }

type Props = {
  components: AssistantUiComponent[];
  pkg: PackageData;
  audit: Audit;
  portion: number;
  portionUnit: 'g' | 'ml';
  onPortionChange: (value: number) => void;
  onPortionUnitChange: (value: 'g' | 'ml') => void;
  onSaveCorrection: (correction: NutrientCorrection) => boolean;
  canInspect: (observation: Observation) => boolean;
  isInspecting: (observation: Observation) => boolean;
  onInspect: (observation: Observation) => void;
  candidates: TentativeStructuredCandidate[];
  interpretedReadings: InterpretedNutrientReading[];
  sources: EvidenceSource[];
  selectedProduct?: ProductRecord | null;
};

export function ThreadGenerativeUI(props: Props) {
  const { components, pkg, audit, candidates, interpretedReadings, sources, selectedProduct } = props;
  if (!components.length) return null;

  const observations = new Map(pkg.observations.map(observation => [observation.id, observation]));
  const sourceMap = new Map(sources.map(source => [source.id, source]));
  const calculations = new Map(audit.calculations.map(calculation => [calculation.id, calculation]));
  const registry: Record<AssistantUiComponent['type'], (component: AssistantUiComponent) => ReactNode> = {
    'nutrition-table': component => {
      if (!component.observationIds.some(id => observations.has(id))) return null;
      return <section className="thread-ui-card" aria-label="Interactive nutrition table" data-testid="thread-ui-component-nutrition-table" key={component.type}>
        <div className="thread-ui-heading"><span className="eyebrow">LABEL INTERACTION</span><strong>Nutrition table</strong></div>
        <NutritionTable pkg={pkg} audit={audit} portion={props.portion} portionUnit={props.portionUnit} onSave={props.onSaveCorrection} canInspect={props.canInspect} isInspecting={props.isInspecting} onInspect={props.onInspect} interpretedReadings={interpretedReadings}/>
      </section>;
    },
    'portion-calculator': component => {
      const rows = component.calculationIds.flatMap(id => calculations.has(id) ? [calculations.get(id)!] : []);
      if (!rows.length) return null;
      return <section className="thread-ui-card" aria-label="Portion calculator" data-testid="thread-ui-component-portion-calculator" key={component.type}>
        <div className="thread-ui-heading"><span className="eyebrow">DETERMINISTIC CALCULATION</span><strong>Try another amount</strong></div>
        <div className="thread-ui-portion"><label>Amount<input type="number" inputMode="decimal" min="1" max="2000" value={props.portion} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0 && value <= 2000) props.onPortionChange(value); }}/></label><label>Unit<select value={props.portionUnit} onChange={event => props.onPortionUnitChange(event.target.value as 'g' | 'ml')}><option value="g">g</option><option value="ml">ml</option></select></label></div>
        <ul className="thread-ui-calculations">{rows.map(row => <li key={row.id}><span>{row.label}{row.interpretationIds?.length ? <small>Based on an unverified interpretation</small> : null}</span><strong>{formatNumber(row.result)} {row.unit}</strong></li>)}</ul>
        <p className="thread-ui-caveat">{rows.some(row => row.interpretationIds?.length) ? 'Some amounts use OCR-linked Gemini interpretations that remain unverified against the original pixels.' : 'Calculated from the recorded label reading and printed basis.'} This is not a portion recommendation.</p>
      </section>;
    },
    'ingredient-explorer': component => renderEvidenceExplorer(component, observations, candidates, 'Ingredient and additive readings', 'Possible extracted readings; check the linked package text and photo.'),
    'allergen-explanation': component => renderEvidenceExplorer(component, observations, candidates, 'Allergen and warning text', 'These are label statements, not a safety assessment. Missing text does not rule out allergens or cross-contact.', ['allergen', 'warning']),
    'product-comparison': component => {
      const selectedSource = selectedProduct ? productEvidenceSource(selectedProduct) : null;
      if (!selectedProduct || !selectedSource || !component.sourceIds.includes(selectedSource.id) || pkg.identityConflict) return null;
      const rows = compareProductNutrition(pkg.nutrients, selectedProduct.nutrients, { identityConflict: !!pkg.identityConflict, interpretedReadings });
      if (!rows.length) return null;
      const reason: Record<string, string> = {
        'package-identity-conflict': 'package identity is disputed', 'package-reading-missing': 'no package reading',
        'record-reading-missing': 'no community-record reading', 'package-reading-conflict': 'package readings conflict',
        'package-basis-unknown': 'package basis is unknown', 'record-basis-unknown': 'record basis is unknown',
        'basis-type-mismatch': 'mass and volume cannot be compared', 'unit-mismatch': 'units cannot be safely converted',
      };
      return <section className="thread-ui-card" aria-label="Product comparison" data-testid="thread-ui-component-product-comparison" key={component.type}>
        <div className="thread-ui-heading"><span className="eyebrow">USER-SELECTED COMMUNITY RECORD</span><strong>Compare recorded nutrition</strong></div>
        <p className="thread-ui-caveat">{selectedProduct.name} is a community-data candidate, not manufacturer verification. Confirm the variant and formulation.{rows.some(row => row.packageReadingSource === 'gemini-interpretation') ? ' Gemini interpretations fill missing package readings only when cited OCR words and layout agree; they remain unverified against original pixels.' : ''}</p>
        <div className="thread-ui-table-scroll" role="region" aria-label="Compared nutrient values" tabIndex={0}><table><thead><tr><th>Nutrient</th><th>This package</th><th>Community record</th><th>Comparison</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}><th>{nutrientLabels[row.key]}</th><td>{renderComparisonPackageValue(row, observations, props)}</td><td>{row.recordReading ? `${formatNumber(row.recordReading.value)} ${row.recordReading.unit}${row.recordReading.basis ? ` per ${row.recordReading.basis.amount} ${row.recordReading.basis.unit}` : ''}` : 'Not reported'}</td><td>{row.status === 'comparable' ? `${formatNumber(row.packagePer100!)} vs ${formatNumber(row.recordPer100!)} ${row.unit} per 100 ${row.basisUnit}` : `Not comparable: ${reason[row.status]}`}</td></tr>)}</tbody></table></div>
        {isSafeEvidenceUrl(selectedProduct.url) && <a className="thread-ui-source-link" href={selectedProduct.url} target="_blank" rel="noreferrer"><BookOpen size={14}/>Inspect community record</a>}
      </section>;
    },
    'package-evidence': component => renderObservationCard(component, observations, props, 'Package evidence', 'OCR text is shown as recognized, not verified.', true),
    'source-reference-cards': component => {
      const selected = safeConversationEvidence(component.sourceIds.flatMap(id => sourceMap.has(id) ? [sourceMap.get(id)!] : []));
      if (!selected.length) return null;
      return <section className="thread-ui-card" aria-label="Supporting sources" data-testid="thread-ui-component-source-reference-cards" key={component.type}>
        <div className="thread-ui-heading"><span className="eyebrow">SOURCE SCOPE AVAILABLE</span><strong>Review supporting sources</strong></div>
        <div className="thread-ui-source-list">{selected.map(source => <article key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><small>{source.publisher} · {source.jurisdiction} · Retrieved {new Date(source.retrievedAt).toLocaleDateString('en-IN')}</small><p>{source.summary}</p><p className="thread-ui-caveat">{source.limitations}</p></article>)}</div>
      </section>;
    },
    'personalized-finding': () => <section className="thread-ui-card thread-ui-personalized" aria-label="Personalized interpretation" data-testid="thread-ui-component-personalized-finding" key="personalized-finding"><Sparkles size={16}/><div><strong>Personal context considered</strong><p>A declared profile statement was cited in this answer. It remains user-provided context, not a verified health fact.</p></div></section>,
    'package-details': component => renderObservationCard(component, observations, props, 'Other package details', 'These source lines may include incomplete or misclassified OCR.', true),
  };

  return <div className="thread-ui-stack" aria-label="Interactive food information">{components.map(component => registry[component.type](component))}</div>;
}

function renderComparisonPackageValue(row: ProductComparisonRow, observations: Map<string, Observation>, props: Props): ReactNode {
  const reading = row.packageReading;
  if (!reading) return 'Not established';
  const linked = row.packageReadingSource === 'gemini-interpretation'
    ? reading.observationIds.flatMap(id => observations.has(id) ? [observations.get(id)!] : [])
    : [];
  return <>
    {formatNumber(reading.value)} {reading.unit}{reading.basis ? ` per ${reading.basis.amount} ${reading.basis.unit}` : ''}
    {row.status === 'package-reading-conflict' && row.packageReadingSource === 'package-observation' && <small className="thread-comparison-provenance">Conflicting package reading · not compared</small>}
    {row.packageReadingSource === 'gemini-interpretation' && <>
      <small className="thread-comparison-provenance">Gemini interpretation · unverified against photo</small>
      {reading.uncertainty && <small className="thread-comparison-provenance">{reading.uncertainty}</small>}
      {linked.length > 0 && <details className="thread-comparison-evidence">
        <summary>Trace to OCR ({linked.length})</summary>
        {linked.map(observation => <div key={observation.id}>
          <q>{observation.text}</q>
          {props.canInspect(observation) && <button type="button" className="thread-region-link" disabled={props.isInspecting(observation)} onClick={() => props.onInspect(observation)}>
            {props.isInspecting(observation) ? 'Opening photo…' : 'Inspect photo region'}
          </button>}
        </div>)}
      </details>}
    </>}
  </>;
}

function renderEvidenceExplorer(component: AssistantUiComponent, observations: Map<string, Observation>, candidates: TentativeStructuredCandidate[], title: string, caveat: string, kinds?: TentativeStructuredCandidate['kind'][]): ReactNode {
  const ids = new Set(component.observationIds.filter(id => observations.has(id)));
  const lines = [...ids].map(id => observations.get(id)!);
  const possible = candidates.filter(candidate => (!kinds || kinds.includes(candidate.kind)) && candidate.observationIds.some(id => ids.has(id)));
  if (!lines.length) return null;
  return <section className="thread-ui-card" aria-label={title} data-testid={'thread-ui-component-' + (kinds ? 'allergen-explanation' : 'ingredient-explorer')} key={component.type}>
    <div className="thread-ui-heading"><span className="eyebrow">OBSERVATION-LED REVIEW</span><strong>{title}</strong></div>
    <p className="thread-ui-caveat">{caveat}</p>
    {possible.length > 0 && <ul className="thread-ui-candidates">{possible.map(candidate => <li key={candidate.candidateId}><span className="badge neutral">Tentative {candidate.kind}</span><strong>{candidate.proposedValue}</strong><small>{candidate.uncertainty}</small></li>)}</ul>}
    <ul className="thread-ui-observations">{lines.map(observation => <li key={observation.id}><q>{observation.text}</q><small>{observation.origin === 'ocr' ? `OCR · ${observation.side} side` : `${observation.origin} observation`}</small></li>)}</ul>
  </section>;
}

function renderObservationCard(component: AssistantUiComponent, observations: Map<string, Observation>, props: Props, title: string, caveat: string, collapsed = false): ReactNode {
  const rows = component.observationIds.flatMap(id => observations.has(id) ? [observations.get(id)!] : []);
  if (!rows.length) return null;
  const content = <>
    <p className="thread-ui-caveat">{caveat}</p>
    <ul className="thread-ui-observations">{rows.map(observation => <li key={observation.id}><q>{observation.text}</q><small>{observation.origin === 'ocr' ? `OCR · ${observation.side} side` : `${observation.origin} observation`}</small>{props.canInspect(observation) && <button className="thread-region-link" type="button" disabled={props.isInspecting(observation)} onClick={() => props.onInspect(observation)}><ScanLine size={13}/><Eye size={13}/>{props.isInspecting(observation) ? 'Opening photo…' : 'Inspect photo region'}</button>}</li>)}</ul>
  </>;
  if (collapsed) return <details className="thread-ui-card thread-ui-evidence-disclosure" aria-label={title} data-testid={'thread-ui-component-' + component.type} key={component.type}>
    <summary><span><strong>{title}</strong><small>{rows.length} observation{rows.length === 1 ? '' : 's'} · OCR and source evidence</small></span><ChevronDown size={15}/></summary>
    <div className="thread-ui-evidence-content">{content}</div>
  </details>;
  return <section className="thread-ui-card" aria-label={title} data-testid={'thread-ui-component-' + component.type} key={component.type}>
    <div className="thread-ui-heading"><span className="eyebrow">SOURCE-LINKED</span><strong>{title}</strong></div>{content}
  </section>;
}
