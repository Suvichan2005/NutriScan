'use client';

import { ArrowRight, ChevronDown, CircleHelp, ScanLine } from 'lucide-react';
import { otherPackageOcrLines, packageLabelEvidenceGroups } from '@/lib/package-label-evidence';
import type { Observation, PackageData } from '@/lib/contracts';

type Props = {
  pkg: PackageData;
  canInspect: (observation: Observation) => boolean;
  isInspecting: (observation: Observation) => boolean;
  onInspect: (observation: Observation) => void;
  onAsk: () => void;
  ocrSideLabel?: (observation: Observation) => string;
};

function sourceLabel(observation: Observation) {
  if (observation.origin === 'ocr') return `OCR · ${observation.side} side`;
  if (observation.origin === 'vision') return 'Visual reading · unverified';
  if (observation.origin === 'barcode') return 'Product record';
  if (observation.origin === 'fixture') return 'Example label';
  return 'Entered text';
}

export function ThreadPackageLabelDetails({ pkg, canInspect, isInspecting, onInspect, onAsk, ocrSideLabel }: Props) {
  const groups = packageLabelEvidenceGroups(pkg);
  const otherLines = otherPackageOcrLines(pkg, groups);
  const count = groups.reduce((sum, group) => sum + group.observations.length, 0) + otherLines.length;
  const hasGroupedAllergenText = groups.some(group => group.field === 'allergens' && group.observations.length > 0);
  if (!count) return null;

  const row = (observation: Observation) => (
    <li className="thread-label-evidence-row" key={observation.id} data-observation-id={observation.id}>
      <p>{observation.text}</p>
      <div className="thread-label-row-meta">
        <span>{observation.origin === 'ocr' ? ocrSideLabel?.(observation) ?? sourceLabel(observation) : sourceLabel(observation)}</span>
        {canInspect(observation) && <button className="thread-region-link" type="button" disabled={isInspecting(observation)} onClick={() => onInspect(observation)}>
          <ScanLine size={13}/>{isInspecting(observation) ? 'Opening photo…' : 'Inspect photo region'}
        </button>}
      </div>
    </li>
  );

  return <details className="thread-label-details" data-testid="package-label-details">
    <summary><span><strong>Ingredients & label text</strong><small>{count} linked or retained observation{count === 1 ? '' : 's'}</small></span><ChevronDown size={15}/></summary>
    <div className="thread-label-details-content">
      <p className="thread-label-caveat"><CircleHelp size={14}/>Text is shown as read and grouped by NutriScan; it may be incomplete or misclassified. Check the photo when a region is available.</p>
      {groups.filter(group => group.field === 'ingredients').map(group => <section key={group.field} className="thread-label-group">
        <h3>{group.label} <span>{group.observations.length}</span></h3><ul>{group.observations.map(row)}</ul>
      </section>)}
      {groups.filter(group => group.field === 'allergens').map(group => <section key={group.field} className="thread-label-group">
        <h3>{group.label} <span>{group.observations.length}</span></h3><ul>{group.observations.map(row)}</ul>
      </section>)}
      {groups.filter(group => group.field === 'claim').map(group => <section key={group.field} className="thread-label-group">
        <h3>{group.label} <span>{group.observations.length}</span></h3><ul>{group.observations.map(row)}</ul>
      </section>)}
      {!hasGroupedAllergenText && <p className="thread-label-missing">No allergen statement was separated from this scan. That does not establish that allergens or cross-contact are absent.</p>}
      {otherLines.length > 0 && <details className="thread-other-ocr-lines">
        <summary><span>Other recognized text <small>{otherLines.length} lines</small></span><ChevronDown size={14}/></summary>
        <ul>{otherLines.map(row)}</ul>
      </details>}
      <button className="text-button thread-label-ask" type="button" onClick={onAsk}>Ask about these label details<ArrowRight size={14}/></button>
    </div>
  </details>;
}
