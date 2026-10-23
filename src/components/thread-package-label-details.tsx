'use client';

import { ChevronDown, CircleHelp, ScanLine } from 'lucide-react';
import { isLowSignalPackageOcrLine, otherPackageOcrLines, packageLabelEvidenceGroups } from '@/lib/package-label-evidence';
import type { Observation, PackageData } from '@/lib/contracts';

type Props = {
  pkg: PackageData;
  canInspect: (observation: Observation) => boolean;
  isInspecting: (observation: Observation) => boolean;
  onInspect: (observation: Observation) => void;
  ocrSideLabel?: (observation: Observation) => string;
  openByDefault?: boolean;
};

function sourceLabel(observation: Observation) {
  if (observation.origin === 'ocr') return `OCR · ${observation.side} side`;
  if (observation.origin === 'vision') return 'Visual reading · unverified';
  if (observation.origin === 'barcode') return 'Product record';
  if (observation.origin === 'fixture') return 'Example label';
  return 'Entered text';
}

export function ThreadPackageLabelDetails({ pkg, canInspect, isInspecting, onInspect, ocrSideLabel, openByDefault = false }: Props) {
  const groups = packageLabelEvidenceGroups(pkg);
  const otherLines = otherPackageOcrLines(pkg, groups);
  const readableLines = otherLines.filter(observation => !isLowSignalPackageOcrLine(observation));
  const shortFragments = otherLines.filter(isLowSignalPackageOcrLine);
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

  return <details className="thread-label-details" data-testid="package-label-details" open={openByDefault || undefined}>
    <summary><span><strong>Package text</strong><small>{count} observation{count === 1 ? '' : 's'}</small></span><ChevronDown size={15}/></summary>
    <div className="thread-label-details-content">
      <p className="thread-label-caveat"><CircleHelp size={14}/>Unconfirmed text. Open a photo region to check the package.</p>
      {groups.filter(group => group.field === 'ingredients').map(group => <section key={group.field} className="thread-label-group">
        <h3>{group.label} <span>{group.observations.length}</span></h3><ul>{group.observations.map(row)}</ul>
      </section>)}
      {groups.filter(group => group.field === 'allergens').map(group => <section key={group.field} className="thread-label-group">
        <h3>{group.label} <span>{group.observations.length}</span></h3><ul>{group.observations.map(row)}</ul>
      </section>)}
      {groups.filter(group => group.field === 'claim').map(group => <section key={group.field} className="thread-label-group">
        <h3>{group.label} <span>{group.observations.length}</span></h3><ul>{group.observations.map(row)}</ul>
      </section>)}
      {!hasGroupedAllergenText && <p className="thread-label-missing">No allergen statement was recognized. Check the package; absence is not confirmed.</p>}
      {otherLines.length > 0 && <details className="thread-other-ocr-lines" open={openByDefault || undefined}>
        <summary><span>Other label text <small>{readableLines.length} lines</small></span><ChevronDown size={14}/></summary>
        {readableLines.length > 0 && <ul>{readableLines.map(row)}</ul>}
        {shortFragments.length > 0 && <details className="thread-low-signal-lines">
          <summary>Show {shortFragments.length} short OCR fragment{shortFragments.length === 1 ? '' : 's'}</summary>
          <ul>{shortFragments.map(row)}</ul>
        </details>}
      </details>}
    </div>
  </details>;
}
