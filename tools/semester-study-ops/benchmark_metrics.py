"""Offline supplementary metrics. Existing OCR scorer remains authoritative for nutrients.
No model, embedding, network, automatic scientific judgment or benchmark execution.
"""
import argparse
from collections import Counter
from decimal import Decimal
import importlib.util
import json
import math
from pathlib import Path
import unicodedata


def normal(text):
    return ' '.join(unicodedata.normalize('NFKC',text).casefold().split())


def ratio(n,d):
    return n/d if d else None


def edit_distance(a,b):
    row=list(range(len(b)+1))
    for i,x in enumerate(a,1):
        nxt=[i]
        for j,y in enumerate(b,1):nxt.append(min(nxt[-1]+1,row[j]+1,row[j-1]+(x!=y)))
        row=nxt
    return row[-1]


def text_errors(reference,prediction):
    """Literal Unicode CER/WER; preserve case/punctuation/digits, normalize whitespace only."""
    if not isinstance(reference,str) or not isinstance(prediction,str):raise ValueError('Literal text required')
    a,b=' '.join(reference.split()),' '.join(prediction.split())
    chars=edit_distance(a,b);words=edit_distance(a.split(),b.split())
    return {'referenceCharacters':len(a),'referenceWords':len(a.split()),'characterEdits':chars,'wordEdits':words,'CER':ratio(chars,len(a)),'WER':ratio(words,len(a.split())),'claimScope':'literal transcription error, not complete nutritional association accuracy'}


def text_items(reference,prediction,grade):
    """Literal association agreement, not semantic/clinical correctness. One-to-one multiset."""
    if grade not in [1,2,3]:raise ValueError('Reference grade required')
    def key(x):
        if not isinstance(x.get('literalText'),str) or not x['literalText'].strip():raise ValueError('Clear item needs literal text')
        if not isinstance(x.get('category'),str) or not x['category'].strip():raise ValueError('Item category required')
        return x['category'],normal(x['literalText']),normal(x.get('printedQuantityOrCode') or '')
    clear=[x for x in reference if x.get('status')=='clear']
    emitted=[x for x in prediction if x.get('status')=='clear']
    a,b=Counter(map(key,clear)),Counter(map(key,emitted));tp=sum((a&b).values())
    # Ingredient sequence agreement includes insertions/deletions, not only matching names.
    ingredients=lambda xs:[key(x) for x in sorted((x for x in xs if x['category']=='ingredients'),key=lambda x:x.get('order') if type(x.get('order')) is int else 10**9)]
    order_known=all(type(x.get('order')) is int for x in clear+emitted if x['category']=='ingredients')
    ai,bi=ingredients(clear),ingredients(emitted)
    return {'claimScope':'candidate-reference-agreement' if grade==3 else 'declared-reference-literal-agreement-requires-provenance-gates',
        'referenceGrade':grade,'referenceProvenanceChecked':False,'expectedClear':len(clear),'predictedClear':len(emitted),'exactMatches':tp,
        'omissions':len(clear)-tp,'unsupportedOrMismatchedItems':len(emitted)-tp,
        'precision':ratio(tp,len(emitted)),'recall':ratio(tp,len(clear)),
        'ingredientSequenceExact':ai==bi if order_known and (ai or bi) else None,
        'unscorableReferenceItems':len(reference)-len(clear),
        'limitation':'Literal matching is not semantic equivalence, allergen safety or regulatory/scientific entailment; absent text is not verified absence.'}


def retrieval(rows):
    """Delegate graded 0–3 relevance and missingness to the established runner."""
    file=Path(__file__).resolve().parents[2]/'scripts/evaluation/run_experiments.py'
    spec=importlib.util.spec_from_file_location('nutriscan_existing_runner',file)
    runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
    return runner.retrieval(rows)


def pointer(value,path):
    if path=='':return value
    if not path.startswith('/'):raise ValueError('JSON pointer required')
    for p in path[1:].split('/'):
        p=p.replace('~1','/').replace('~0','~')
        if isinstance(value,list):value=value[int(p)]
        elif isinstance(value,dict):value=value[p]
        else:raise KeyError(path)
    return value


def state_assertions(actual,assertions):
    """BFCL-inspired state outcomes; alternative valid tool plans remain valid."""
    results=[]
    if len({a['id'] for a in assertions})!=len(assertions):raise ValueError('Duplicate assertion ID')
    for a in assertions:
        op=a['op']
        if op not in ['equals','absent','numeric-close']:raise ValueError('Unknown assertion operation')
        try:value=pointer(actual,a['path']);exists=True
        except (KeyError,IndexError,TypeError,ValueError):value=None;exists=False
        passed=False
        if op=='absent':passed=not exists
        elif op=='equals':passed=exists and type(value)==type(a['expected']) and value==a['expected']
        elif exists:
            if type(value) not in [int,float,str] or type(a['expected']) not in [int,float,str]:raise ValueError('Numeric assertion needs actual numbers, not booleans')
            tolerance=Decimal(str(a.get('absoluteTolerance',0)))
            x,y=Decimal(str(value)),Decimal(str(a['expected']))
            if not all(v.is_finite() for v in [x,y,tolerance]) or tolerance<0:raise ValueError('Invalid numerical assertion')
            passed=abs(x-y)<=tolerance
        results.append({'id':a['id'],'passed':passed,'missing':not exists})
    return {'assertions':results,'passed':sum(r['passed'] for r in results),'total':len(results),'passRate':ratio(sum(r['passed'] for r in results),len(results)),'claimScope':'declared deterministic state only; not answer entailment or human usefulness'}


def atomic_support(answer,claims,known_evidence,assessor_type):
    """Aggregate supplied, response-bound judgments, without generating any judgments."""
    if assessor_type not in ['independent-human','owner-developer','AI-assisted','synthetic']:raise ValueError('Assessor provenance required')
    if len({c['id'] for c in claims})!=len(claims):raise ValueError('Duplicate claim ID')
    for c in claims:
        if c['verdict'] not in ['supported','contradicted','unsupported','unverifiable']:raise ValueError('Invalid verdict')
        if not c.get('span') or c['span'] not in answer:raise ValueError('Claim quote is absent from response')
        if c['kind'] not in ['package','calculation','scientific','interpretation']:raise ValueError('Unknown claim kind')
        if c['verdict']=='supported' and not c.get('evidenceIds'):raise ValueError('Supported claim needs evidence')
        if any(e not in known_evidence for e in c.get('evidenceIds',[])):raise ValueError('Unknown evidence identity')
        if not c.get('reason'):raise ValueError('Judgment rationale required')
    counts=Counter(c['verdict'] for c in claims)
    return {'assessorType':assessor_type,'claimCounts':dict(counts),'claims':len(claims),'supportedFraction':ratio(counts['supported'],len(claims)),
        'claimScope':'FActScore-inspired supplied atomic judgments, not canonical FActScore or verified entailment; report coverage, abstentions and assessor limitations separately'}


def grits(reference,prediction):
    """Pinned, unmodified official Microsoft GriTS; geometry only when actually present."""
    if not reference or not prediction: return {'status':'UNSCORABLE','reason':'Both explicit table cell grids required; no inferred grid from nutrient list'}
    def validate(cells):
        occupied=set()
        for c in cells:
            for key in ['row_nums','column_nums']:
                v=c.get(key)
                if not isinstance(v,list) or not v or any(type(i)is not int or i<0 for i in v) or sorted(set(v))!=list(range(min(v),max(v)+1)):raise ValueError('Explicit contiguous nonnegative cell spans required')
            if not isinstance(c.get('cell_text'),str):raise ValueError('Cell text required, including empty cells')
            for row in c['row_nums']:
                for col in c['column_nums']:
                    if (row,col) in occupied:raise ValueError('Overlapping cells')
                    occupied.add((row,col))
        area=(max(r for r,c in occupied)+1)*(max(c for r,c in occupied)+1)
        if len(occupied)!=area or area>1024:raise ValueError('Explicit complete bounded grids required, including empty cells')
    validate(reference);validate(prediction)
    p=Path(__file__).parent/'vendor/table_transformer/grits.py'
    import hashlib
    metadata=json.loads((p.parent/'UPSTREAM.json').read_text(encoding='utf8'))
    expected=next(f['sha256'] for f in metadata['files'] if f['path']=='grits.py')
    if hashlib.sha256(p.read_bytes()).hexdigest()!=expected:raise ValueError('Pinned GriTS source changed')
    spec=importlib.util.spec_from_file_location('nutriscan_upstream_grits',p);up=importlib.util.module_from_spec(spec);spec.loader.exec_module(up)
    import numpy as np
    def grid(rows):
        value=np.empty((len(rows),len(rows[0])),dtype=object)
        for r,row in enumerate(rows):
            for c,cell in enumerate(row):value[r,c]=cell
        return value
    out={'status':'SCORED','upstreamCommit':metadata['commit'],'content':up.grits_con(grid(up.cells_to_grid(reference,'cell_text')),grid(up.cells_to_grid(prediction,'cell_text'))),
        'topology':up.grits_top(grid(up.cells_to_relspan_grid(reference)),grid(up.cells_to_relspan_grid(prediction))),'location':None}
    if all('bbox' in c for c in reference+prediction):
        for c in reference+prediction:
            b=c['bbox']
            if len(b)!=4 or any(type(v) not in [int,float] or not math.isfinite(v) for v in b) or b[2]<=b[0] or b[3]<=b[1]:raise ValueError('Invalid cell geometry')
        out['location']=up.grits_loc(grid(up.cells_to_grid(reference,'bbox')),grid(up.cells_to_grid(prediction,'bbox')))
    out['tupleOrder']=['fscore','precision','recall','upperBound'];return out


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('metric',choices=['text','ocr-text','retrieval','state','atomic','grits']);p.add_argument('input',type=Path);p.add_argument('--output',type=Path,required=True);a=p.parse_args();d=json.loads(a.input.read_text(encoding='utf-8-sig'))
    functions={'text':text_items,'ocr-text':text_errors,'retrieval':retrieval,'state':state_assertions,'atomic':atomic_support,'grits':grits}
    value=functions[a.metric](**d)
    with a.output.open('x',encoding='utf8') as f:json.dump(value,f,ensure_ascii=False,indent=2,default=lambda x:x.item() if hasattr(x,'item') else str(x));f.write('\n')
if __name__=='__main__':main()
