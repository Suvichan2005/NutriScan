"""Apply explicit source-verified bibliography corrections to a fresh private copy."""
import argparse
import copy
import csv
import hashlib
import json
from pathlib import Path
import study_ops as ops


def corrected(bibliography,raw_sha,review):
    if review.get('schemaVersion')!=1 or review.get('inputBibliographySha256')!=raw_sha:raise ValueError('Original bibliography changed since review')
    rows={r['id']:r for r in bibliography['records']};verified={r['id']:r for r in review['records']}
    if len(rows)!=len(bibliography['records']) or len(verified)!=len(review['records']) or set(rows)!=set(verified):raise ValueError('Review IDs do not match bibliography')
    result=copy.deepcopy(bibliography);target={r['id']:r for r in result['records']};seen=set()
    for u in review['fieldUpdates']:
        key=(u['id'],u['field'])
        if key in seen:raise ValueError('Duplicate field correction')
        seen.add(key)
        if u['id'] not in rows or u['field'] not in {'authors','title','year','version','url','doi'}:raise ValueError('Only explicit bibliographic metadata may be corrected')
        source=verified[u['id']]
        if source['status']!='PRIMARY_METADATA_OR_DOCUMENTATION_CHECKED' or source['primaryUrl']!=u['primaryUrl'] or not u.get('reason'):raise ValueError('Correction lacks verified primary record')
        before=rows[u['id']][u['field']]
        if hashlib.sha256(str(before).encode()).hexdigest()!=u['expectedValueSha256']:raise ValueError('Field changed since review')
        if not u.get('value'):raise ValueError('Empty corrected metadata')
        target[u['id']][u['field']]=u['value']
    result['metadataCorrectionOverlay']={'checkedAt':review['checkedAt'],'scope':review['scope'],'originalSha256':raw_sha,'correctedFields':len(review['fieldUpdates']),'accessLimitedSources':[r['id'] for r in review['records'] if r['status']=='ACCESS_LIMITED'],'originalScientificClaimsUnchanged':True}
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--bibliography',type=Path,required=True);p.add_argument('--review',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    result=corrected(ops.load(a.bibliography),ops.sha(a.bibliography),ops.load(a.review))
    if '.data' not in a.output.resolve().parts:raise ValueError('Corrected owner bibliography copies must remain private')
    a.output.mkdir(parents=True,exist_ok=False)
    (a.output/'bibliography-corrected-copy.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    with (a.output/'verification-status.csv').open('w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=['id','status','verificationDepth','primaryUrl','note']);w.writeheader();w.writerows({k:r[k] for k in w.fieldnames} for r in ops.load(a.review)['records'])
    print(json.dumps(result['metadataCorrectionOverlay'],indent=2))
if __name__=='__main__':main()
