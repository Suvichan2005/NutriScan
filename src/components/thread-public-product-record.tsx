'use client';

import { BookOpen, Search } from 'lucide-react';
import { isSafeEvidenceUrl } from '@/lib/followup-evidence';
import { productIdentityDisclosure, type ProductQuerySource } from '@/lib/product-query';
import type { ProductRecord } from '@/lib/contracts';
import { CommunityProductRecordDetails } from './community-product-record-details';

type Props = {
  product: ProductRecord;
  packageBarcode?: string;
  querySource: ProductQuerySource;
  identityConflict: boolean;
  canCompare: boolean;
  otherCandidates: ProductRecord[];
  onCompare: (product: ProductRecord) => void;
};

function formatNumber(value: number) {
  return Number(value.toFixed(2)).toLocaleString('en-IN');
}

export function ThreadPublicProductRecord({
  product,
  packageBarcode,
  querySource,
  identityConflict,
  canCompare,
  otherCandidates,
  onCompare,
}: Props) {
  const searchDisclosure = querySource === 'barcode'
    ? 'Only the decoded package barcode was sent to Open Food Facts. Photos and personal context stayed in this browser.'
    : querySource === 'barcode-candidate'
      ? 'Only a checksum-valid number recognized in package OCR was sent as a possible barcode. It is not confirmed as the package barcode; photos and personal context stayed in this browser.'
    : querySource === 'user-detail'
      ? 'Only the product detail you entered was sent to Open Food Facts. Photos and personal context stayed in this browser.'
    : querySource === 'reconstruction'
      ? 'The unverified product name, brand and variant interpreted from the package were sent to Open Food Facts. Photos and personal context stayed in this browser.'
      : 'Only the product text recognized from the package was sent to Open Food Facts. Photos and personal context stayed in this browser.';

  return (
    <article className="thread-public-record" aria-label="Public product record" data-testid="thread-public-product-record">
      <div className="thread-public-record-heading">
        <span className="eyebrow"><Search size={12}/> OPEN FOOD FACTS · COMMUNITY RECORD</span>
        <span className="badge neutral">{product.match === 'barcode' ? 'Barcode match' : 'Search candidate'}</span>
      </div>
      <h2>{product.name}</h2>
      <p className="thread-public-record-meta">{[product.brand, product.quantity].filter(Boolean).join(' · ') || 'Brand and pack size not listed'}</p>
      <p className="thread-public-record-disclosure">{searchDisclosure}</p>
      <p className="thread-public-record-caveat">
        {productIdentityDisclosure(packageBarcode, product.barcode, product.match)} This community record is not manufacturer verification; confirm the exact regional formulation and label date. Local stock is unverified.
      </p>
      <details className="thread-public-record-nutrients">
        <summary>Recorded nutrition · {product.nutrients.length} fields</summary>
        {product.nutrients.length ? <ul>{product.nutrients.slice(0, 20).map((item, index) => <li key={`${item.key}-${index}`}>
          <span>{item.key.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toLocaleUpperCase('en-IN'))}</span>
          <strong>{formatNumber(item.value)} {item.unit}{item.basis ? ` per ${item.basis.amount} ${item.basis.unit}` : ' · basis not reported'}</strong>
        </li>)}</ul> : <p>No nutrition values are recorded.</p>}
        {product.nutrients.length > 20 && <p className="fine-print">Showing 20 of {product.nutrients.length} recorded fields.</p>}
        <p className="fine-print">Catalog values are separate from the photographed label and may be incomplete or outdated.</p>
      </details>
      {otherCandidates.length > 0 && <details className="thread-public-record-candidates">
        <summary>Review {otherCandidates.length} other community {otherCandidates.length === 1 ? 'candidate' : 'candidates'}</summary>
        <ul>{otherCandidates.map(candidate => <li key={candidate.id}>
          <div><strong>{candidate.name}</strong><small>{[candidate.brand, candidate.quantity, candidate.barcode ? `Barcode ${candidate.barcode}` : 'Barcode not listed'].filter(Boolean).join(' · ')}</small><small>{candidate.nutrients.length} nutrient fields · {candidate.ingredients ? 'ingredients listed' : 'ingredients not listed'} · local stock unverified</small></div>
          <div className="thread-public-record-candidate-actions">
            {isSafeEvidenceUrl(candidate.url) && <a href={candidate.url} target="_blank" rel="noreferrer">Inspect</a>}
            <button type="button" className="text-button" disabled={!canCompare || identityConflict} title={identityConflict ? 'Resolve package identity conflicts before comparing.' : !canCompare ? 'Read some package nutrition values before comparing.' : undefined} onClick={() => onCompare(candidate)}>Compare</button>
          </div>
        </li>)}</ul>
        <p className="fine-print">Catalog candidates are not a ranking or suitability recommendation. Verify the exact variant and label.</p>
      </details>}
      <CommunityProductRecordDetails product={product}/>
      <div className="thread-public-record-actions">
        {isSafeEvidenceUrl(product.url) && <a href={product.url} target="_blank" rel="noreferrer"><BookOpen size={14}/>Inspect source</a>}
        {canCompare && <button type="button" className="text-button" disabled={identityConflict} title={identityConflict ? 'Resolve package identity conflicts before comparing.' : undefined} onClick={() => onCompare(product)}>Compare with this label</button>}
      </div>
    </article>
  );
}
