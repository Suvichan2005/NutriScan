"""Record explicit human adjudication without changing either independent rating."""
import argparse
from collections import defaultdict
from datetime import datetime
from pathlib import Path
import study_ops as ops


def disagreement_packet(ratings, key):
    ops.validate_ratings(ratings,key)
    grouped=defaultdict(list)
    for r in ratings:grouped[r['blindResponseId']].append(r)
    dimensions=ops.definitions()[1]['humanReview']['dimensions'];out=[]
    for entry in key:
        ident=entry['blindResponseId'];rows=grouped[ident]
        values={d:[{'reviewerCode':r['raterCode'],'score':r['scores'][d],'notApplicableReason':r.get('notApplicableReasons',{}).get(d)} for r in rows] for d in dimensions}
        disagreements=[d for d in dimensions if len({r['scores'][d] for r in rows})>1]
        out.append({'blindResponseId':ident,'contextSha256':entry['contextSha256'],'responseSha256':entry['responseSha256'],'status':'PENDING_READERS' if len(rows)<2 else 'PENDING_ADJUDICATOR','ratingSetSha256':ops.canonical(sorted(rows,key=lambda r:r['raterCode'])),'reviewerCodes':sorted(r['raterCode'] for r in rows),'dimensions':values,'disagreements':disagreements,'criticalErrors':[{'reviewerCode':r['raterCode'],'index':i,'record':e} for r in rows for i,e in enumerate(r['criticalErrors'])]})
    return {'scope':'custodian-only; not reviewer-blind material','responses':out,'humanDecisions':[]}


def adjudicate(ratings,key,decisions):
    packet=disagreement_packet(ratings,key);joins={r['blindResponseId']:r for r in packet['responses']};seen=set();resolved=[]
    dimensions=ops.definitions()[1]['humanReview']['dimensions']
    for d in decisions:
        ident=d.get('blindResponseId')
        if ident not in joins or ident in seen:raise ValueError('Unknown/duplicate adjudication response')
        seen.add(ident);j=joins[ident]
        if j['status']=='PENDING_READERS':raise ValueError('Cannot adjudicate before two independent ratings')
        for k in ('contextSha256','responseSha256','ratingSetSha256'):
            if d.get(k)!=j[k]:raise ValueError('Adjudication references changed response/context/rating set')
        code=d.get('adjudicatorCode')
        if not code or code in j['reviewerCodes'] or d.get('provenance')!='independent-human':raise ValueError('Distinct human adjudicator required')
        when=datetime.fromisoformat(d.get('assessedAt','').replace('Z','+00:00'))
        if when.tzinfo is None:raise ValueError('Adjudication timezone required')
        prior=[datetime.fromisoformat(r['assessedAt'].replace('Z','+00:00')) for r in ratings if r['blindResponseId']==ident]
        if any(when<t for t in prior):raise ValueError('Adjudication predates an independent rating')
        if not d.get('reason') or not d.get('evidencePointers'):raise ValueError('Adjudication evidence/reason required')
        if set(d.get('scores',{}))!=set(dimensions):raise ValueError('Nine adjudicated dimensions required')
        for dim,value in d['scores'].items():
            if value is None:
                if not d.get('notApplicableReasons',{}).get(dim):raise ValueError('Adjudicated N/A requires reason')
            elif type(value)!=int or not 0<=value<=4:raise ValueError('Adjudicated score must be integer 0–4')
            originals={r['score'] for r in j['dimensions'][dim]}
            if (len(originals)>1 or value not in originals) and not d.get('dimensionReasons',{}).get(dim):
                raise ValueError('Disputed or changed dimension requires explicit reason')
        expected={(e['reviewerCode'],e['index']) for e in j['criticalErrors']};actual=set()
        for e in d.get('criticalErrorDecisions',[]):
            ref=(e.get('reviewerCode'),e.get('index'))
            if ref not in expected or ref in actual:raise ValueError('Unknown/duplicate critical-error resolution')
            actual.add(ref)
            if e.get('decision') not in {'confirmed','rejected','unresolved'} or not e.get('reason') or not e.get('evidencePointer'):
                raise ValueError('Critical-error resolution requires decision, reason and evidence')
        if actual!=expected:raise ValueError('Every reviewer critical error needs an explicit decision')
        unresolved=any(e['decision']=='unresolved' for e in d.get('criticalErrorDecisions',[]))
        resolved.append({**d,'status':'UNRESOLVED' if unresolved else 'ADJUDICATED'})
    pending=[ident for ident in joins if ident not in seen]
    return {'status':'PENDING' if not joins or pending or any(r['status']=='UNRESOLVED' for r in resolved) else 'ADJUDICATED_RECORDS_ONLY','pendingResponses':pending,'decisions':resolved,'originalRatingsSha256':ops.canonical(ratings),'originalRatingsPreserved':True,'scope':'human-declared records validated structurally; not authenticated humans or scientific validity','finalStudyResult':False}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--ratings',type=Path,required=True);p.add_argument('--key',type=Path,required=True);p.add_argument('--decisions',type=Path)
    a=p.parse_args();ratings=ops.load(a.ratings);key=ops.load(a.key)
    result=adjudicate(ratings,key,ops.load(a.decisions)) if a.decisions else disagreement_packet(ratings,key)
    import json
    print(json.dumps(result,indent=2))
if __name__=='__main__':main()
